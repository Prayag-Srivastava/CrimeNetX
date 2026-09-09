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


def predict_links(g: nx.DiGraph, threshold: float = 0.10, top_n: int = 30) -> list[LinkPrediction]:
    """Predict missing edges. `g` is the directed graph; we analyze the
    underlying undirected version for the heuristics."""
    und = g.to_undirected()
    nodes = list(und.nodes)
    logger.info(f"Ghost link prediction: {len(nodes)} nodes, {und.number_of_edges()} edges, threshold={threshold}")

    scored: dict[tuple[str, str], dict[str, float]] = {}
    for i, u in enumerate(nodes):
        u_type = str(und.nodes[u].get("entity_type", "PERSON")).upper()
        if u_type in ("ORGANIZATION", "LOCATION", "DATE", "LAW_SECTION"):
            continue

        # Skip non-criminals (victims, witnesses, police officers, aliases, noise)
        u_non_criminal = bool(
            und.nodes[u].get("is_victim")
            or und.nodes[u].get("is_witness")
            or und.nodes[u].get("is_police")
            or und.nodes[u].get("is_alias")
            or und.nodes[u].get("is_noise")
            or und.nodes[u].get("role") in ("VICTIM", "WITNESS", "POLICE_OFFICER", "ALIAS")
        )
        if u_non_criminal:
            continue

        for v in nodes[i + 1 :]:
            v_type = str(und.nodes[v].get("entity_type", "PERSON")).upper()
            if v_type in ("ORGANIZATION", "LOCATION", "DATE", "LAW_SECTION"):
                continue

            v_non_criminal = bool(
                und.nodes[v].get("is_victim")
                or und.nodes[v].get("is_witness")
                or und.nodes[v].get("is_police")
                or und.nodes[v].get("is_alias")
                or und.nodes[v].get("is_noise")
                or und.nodes[v].get("role") in ("VICTIM", "WITNESS", "POLICE_OFFICER", "ALIAS")
            )
            if v_non_criminal:
                continue

            if und.has_edge(u, v):
                continue  # only predict links that DON'T exist yet

            cn = _common_neighbors(und, u, v)
            jc = _jaccard(und, u, v)
            aa = _adamic_adar(und, u, v)

            # Path proximity & sub-network cohesion
            path_prox = 0.0
            if cn > 0:
                path_prox = 1.0
            elif nx.has_path(und, u, v):
                plen = nx.shortest_path_length(und, u, v)
                path_prox = 1.0 / plen
            elif und.degree(u) > 0 and und.degree(v) > 0:
                path_prox = 0.35

            scored[(u, v)] = {
                "common_neighbors": cn,
                "jaccard": jc,
                "adamic_adar": aa,
                "path_prox": path_prox,
            }

    if not scored:
        logger.info("Ghost link prediction: no candidate pairs found (all filtered or already connected)")
        return []

    # Min-max normalize classical algorithms if max > 0
    for alg in ["common_neighbors", "jaccard", "adamic_adar"]:
        vals = [s[alg] for s in scored.values()]
        mx = max(vals)
        if mx > 0:
            for s in scored.values():
                s[alg] = s[alg] / mx

    blended = []
    for pair, s in scored.items():
        classical_avg = (s["common_neighbors"] + s["jaccard"] + s["adamic_adar"]) / 3.0
        if classical_avg > 0:
            final_score = round(0.7 * classical_avg + 0.3 * s["path_prox"], 4)
        else:
            # For pairs of PERSON nodes that share no common neighbors but exist in the graph,
            # give a small baseline if they are both connected to at least one other node
            u_type = str(und.nodes[pair[0]].get("entity_type", "PERSON")).upper()
            v_type = str(und.nodes[pair[1]].get("entity_type", "PERSON")).upper()
            if u_type == "PERSON" and v_type == "PERSON" and s["path_prox"] > 0:
                final_score = round(s["path_prox"] * 0.5, 4)
            else:
                final_score = round(s["path_prox"] * 0.3, 4)
        blended.append((pair, final_score, s))

    blended.sort(key=lambda t: t[1], reverse=True)

    predictions = []
    for pair, score, s in blended:
        if score < threshold:
            continue
        u, v = pair
        u_label = str(g.nodes[u].get("label") or u)
        v_label = str(g.nodes[v].get("label") or v)

        if s["common_neighbors"] > 0:
            rationale = (
                f"Shared contacts: {s['common_neighbors']:.2f} · Jaccard {s['jaccard']:.2f} · "
                f"Adamic-Adar {s['adamic_adar']:.2f}"
            )
        elif s.get("path_prox", 0) >= 0.5:
            rationale = "Indirect 2-hop connection in syndicate: high sub-network operational overlap"
        elif s.get("path_prox", 0) > 0:
            rationale = "Multi-hop path across syndicate cells: suspected covert relay channel"
        else:
            rationale = "Syndicate co-operatives with zero observed direct calls (proxy avoidance)"

        predictions.append(
            LinkPrediction(
                source=u,
                target=v,
                source_label=u_label,
                target_label=v_label,
                score=score,
                algorithm="ensemble(common_neighbors+jaccard+adamic_adar+path_prox)",
                rationale=rationale,
            )
        )
        if len(predictions) >= top_n:
            break

    logger.info(f"Ghost link prediction: {len(scored)} candidate pairs evaluated, {len(predictions)} predictions above threshold {threshold}")
    return predictions


def predict(case_id: str, entities: list[dict], relations: list[dict], threshold: float = 0.15) -> LinkPredictionResponse:
    from app.services.graph_analyzer import build_graph

    g, _ = build_graph(case_id, entities, relations)
    preds = predict_links(g, threshold=threshold) if g.number_of_nodes() > 1 else []
    return LinkPredictionResponse(case_id=case_id, predictions=preds, threshold=threshold)
