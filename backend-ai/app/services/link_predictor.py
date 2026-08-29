"""Ghost Link Predictor — hidden relationship prediction.

Three classical link-prediction heuristics over the undirected network:
  - Common Neighbors   : count of shared contacts (cheap, interpretable)
  - Jaccard Coefficient: shared contacts normalized by union size
  - Adamic-Adar        : shared contacts weighted by rarity (log-degree penalty
                         on hubs) — best for sparse criminal networks where
                         popular nodes (brokers) would otherwise dominate.

Scores are min-max normalized per algorithm and blended with equal weight.
Investigators accept/reject predictions in the UI (backed by Alert events).
"""
from __future__ import annotations

import logging

import networkx as nx

from app.models.schemas import LinkPrediction, LinkPredictionResponse

logger = logging.getLogger("crimenetx.links")

ALGORITHMS = ["common_neighbors", "jaccard", "adamic_adar"]


def _common_neighbors(g: nx.Graph, u: str, v: str) -> float:
    return float(len(list(nx.common_neighbors(g, u, v))))


def _jaccard(g: nx.Graph, u: str, v: str) -> float:
    nu = set(g.neighbors(u))
    nv = set(g.neighbors(v))
    union = nu | nv
    return float(len(nu & nv)) / float(len(union)) if union else 0.0


def _adamic_adar(g: nx.Graph, u: str, v: str) -> float:
    """Adamic-Adar: sum over common neighbors of 1/log(degree(neighbor)).

    The log penalty down-weights high-degree hub nodes so that shared rare
    contacts (who are more informative) dominate the score — ideal for
    criminal networks full of well-connected brokers."""
    import math

    try:
        return float(sum(1.0 / math.log(1 + g.degree(w)) for w in nx.common_neighbors(g, u, v)))
    except (ZeroDivisionError, ValueError):
        return 0.0


def predict_links(g: nx.DiGraph, threshold: float = 0.15, top_n: int = 30) -> list[LinkPrediction]:
    """Predict missing edges. `g` is the directed graph; we analyze the
    underlying undirected version for the heuristics."""
    und = g.to_undirected()
    nodes = list(und.nodes)

    scored: dict[tuple[str, str], dict[str, float]] = {}
    for i, u in enumerate(nodes):
        for v in nodes[i + 1 :]:
            if und.has_edge(u, v):
                continue  # only predict links that DON'T exist yet
            scored[(u, v)] = {
                "common_neighbors": _common_neighbors(und, u, v),
                "jaccard": _jaccard(und, u, v),
                "adamic_adar": _adamic_adar(und, u, v),
            }

    if not scored:
        return []

    # Min-max normalize each algorithm column so weights are comparable.
    for alg in ALGORITHMS:
        vals = [s[alg] for s in scored.values()]
        mx = max(vals)
        if mx > 0:
            for s in scored.values():
                s[alg] = s[alg] / mx

    # Blend + sort descending.
    blended = sorted(
        (
            (pair, round(sum(s.values()) / len(ALGORITHMS), 4), s)
            for pair, s in scored.items()
        ),
        key=lambda t: t[1],
        reverse=True,
    )

    predictions = [
        LinkPrediction(
            source=pair[0],
            target=pair[1],
            source_label=str(g.nodes[pair[0]].get("label", pair[0])),
            target_label=str(g.nodes[pair[1]].get("label", pair[1])),
            score=score,
            algorithm="ensemble(common_neighbors+jaccard+adamic_adar)",
            rationale=(
                f"Shared contacts: {s['common_neighbors']:.2f} · Jaccard {s['jaccard']:.2f} · "
                f"Adamic-Adar {s['adamic_adar']:.2f}"
            ),
        )
        for pair, score, s in blended
        if score >= threshold
    ][:top_n]
    return predictions


def predict(case_id: str, entities: list[dict], relations: list[dict], threshold: float = 0.15) -> LinkPredictionResponse:
    from app.services.graph_analyzer import build_graph

    g, _ = build_graph(case_id, entities, relations)
    preds = predict_links(g, threshold=threshold) if g.number_of_nodes() > 1 else []
    return LinkPredictionResponse(case_id=case_id, predictions=preds, threshold=threshold)
