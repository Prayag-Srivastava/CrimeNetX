"""Graph ML analytics — NetworkX directed graph from extracted entities.

Centrality algorithms computed:
  - PageRank            : who is referenced/connected TO most (influence flow)
  - Betweenness         : who sits on the shortest paths between others (brokers)
  - Degree centrality   : raw connection count
  - Eigenvector         : connections to well-connected people (prestige)

Composite Kingpin Score (0-100):
  z-scored blend of the four centralities -> sigmoid -> scaled 0..100.
  Role: KINGPIN > 70, BROKER 40-70, EXECUTOR < 40.
"""
from __future__ import annotations

import logging
from typing import Any
from weakref import ref

import networkx as nx

from app.models.schemas import (
    GraphEdge,
    GraphNode,
    GraphRole,
    KingpinScoreRow,
    NetworkGraph,
    RelationType,
)

logger = logging.getLogger("crimenetx.graph")

# Weights blend how much each centrality contributes to the composite score.
# Betweenness is weighted highest because brokers/kingpins usually act as
# intermediaries in criminal networks (money + info flow through them).
CENTRALITY_WEIGHTS = {
    "pagerank": 0.30,
    "betweenness": 0.35,
    "degree": 0.20,
    "eigenvector": 0.15,
}


def build_graph(
    case_id: str,
    entities: list[dict[str, Any]],
    relations: list[dict[str, Any]],
) -> tuple[nx.DiGraph, dict[str, dict[str, Any]]]:
    """Build a NetworkX directed graph from extracted entities + relations."""
    g = nx.DiGraph()
    meta: dict[str, dict[str, Any]] = {}  # entity_id -> attributes

    for ent in entities:
    # Preserve the canonical database Entity ID whenever available.
    # Only derive an ID for raw entities that do not have one.
        eid = str(
            ent.get("id")
            or f"{ent.get('type', 'ENTITY')}:{ent.get('value', '')}"
        )

        g.add_node(eid)

        meta[eid] = {
            "label": str(ent.get("value", "")),
            "entity_type": str(ent.get("type", "ENTITY")),
            "entity_id": eid,
        }

    # Value -> node-id index so relations that reference entity *values*
    # (e.g. LLM output) can be resolved even when ids differ.
    value_index: dict[str, str] = {}
    for ent in entities:
        eid = str(ent.get("id") or f"{ent.get('type', 'ENTITY')}:{ent.get('value', '')}")
        value_index.setdefault(str(ent["value"]).upper(), eid)

    def resolve(ref: str) -> str | None:
        ref = str(ref).strip()

    # First: exact canonical entity ID.
        if ref in g:
            return ref

    # Second: entity value.
        return value_index.get(ref.upper())

    for rel in relations:
        src, tgt = resolve(str(rel["source"])), resolve(str(rel["target"]))
        if src is None or tgt is None:
            continue
        weight = float(rel.get("weight", 1.0))
        # Multi-edges accumulate weight: repeated calls/transfers strengthen the link.
        if g.has_edge(src, tgt):
            g[src][tgt]["weight"] += weight
            g[src][tgt]["evidence"].append(rel.get("evidence", ""))
        else:
            g.add_edge(src, tgt, weight=weight, relation=rel.get("relation", "associate"), evidence=[rel.get("evidence", "")])
    return g, meta


def _zscore_map(values: dict[str, float]) -> dict[str, float]:
    """Robust z-score: (x - median) / (MAD + epsilon) — less sensitive to the
    heavy-tailed centrality distributions typical of criminal networks than
    mean/std (a single super-connected node would otherwise squash everyone)."""
    import numpy as np

    arr = np.array(list(values.values()), dtype=float)
    if arr.size == 0 or arr.std() == 0:
        return {k: 0.0 for k in values}
    med = np.median(arr)
    mad = np.median(np.abs(arr - med)) or 1.0
    return {k: float((v - med) / (mad + 1e-9)) for k, v in values.items()}


def _sigmoid(x: float) -> float:
    import math

    return 1.0 / (1.0 + math.exp(-x))


def _eigenvector_safe(g: nx.DiGraph) -> dict[str, float]:
    """Eigenvector centrality that tolerates disconnected graphs.

    nx.eigenvector_centrality_numpy raises AmbiguousSolution on disconnected
    graphs (the eigenvector is not unique across components). Criminal networks
    are almost always fragmented, so we compute per weakly-connected component
    and merge — centrality of a node only needs to be meaningful *within* its
    own cell, which is exactly what investigators care about.
    """
    result: dict[str, float] = {}
    for comp_nodes in nx.weakly_connected_components(g):
        sub = g.subgraph(comp_nodes)
        if sub.number_of_nodes() == 1:
            result[list(comp_nodes)[0]] = 1.0
            continue
        try:
            ev = nx.eigenvector_centrality_numpy(sub)
        except Exception:
            # Last-resort fallback: use degree as a cheap proxy.
            ev = nx.degree_centrality(sub)
        for nid, val in ev.items():
            result[nid] = val
    return result


def compute_kingpin_scores(g: nx.DiGraph) -> dict[str, KingpinScoreRow]:
    """Run centrality analysis and calculate investigation-oriented scores.

    Isolated nodes are retained in the graph for visibility/provenance, but
    they cannot be kingpins or brokers because they have no relationships.
    """

    if g.number_of_nodes() == 0:
        return {}

    pagerank = nx.pagerank(g, alpha=0.85, weight="weight")
    betweenness = nx.betweenness_centrality(g, weight="weight")
    degree = nx.degree_centrality(g)
    eigenvector = _eigenvector_safe(g)

    rows: dict[str, KingpinScoreRow] = {}

    # Only connected nodes participate in the kingpin/broker scoring.
    connected_nodes = {
        node
        for node in g.nodes
        if g.degree(node) > 0
    }

    # If the graph contains no relationships, every node is isolated.
    if not connected_nodes:
        for node in g.nodes:
            rows[node] = KingpinScoreRow(
                entity_id=node,
                label="",
                pagerank=round(pagerank.get(node, 0.0), 6),
                betweenness=0.0,
                degree=0.0,
                eigenvector=round(eigenvector.get(node, 0.0), 6),
                composite=0.0,
                role=GraphRole.EXECUTOR,
            )
        return rows

    # Calculate robust z-scores only across nodes that actually participate
    # in relationships.
    connected_pagerank = {
        n: pagerank[n] for n in connected_nodes
    }
    connected_betweenness = {
        n: betweenness[n] for n in connected_nodes
    }
    connected_degree = {
        n: degree[n] for n in connected_nodes
    }
    connected_eigenvector = {
        n: eigenvector[n] for n in connected_nodes
    }

    zs = {
        "pagerank": _zscore_map(connected_pagerank),
        "betweenness": _zscore_map(connected_betweenness),
        "degree": _zscore_map(connected_degree),
        "eigenvector": _zscore_map(connected_eigenvector),
    }

    for node in g.nodes:
        # No relationships = no network role.
        if node not in connected_nodes:
            rows[node] = KingpinScoreRow(
                entity_id=node,
                label="",
                pagerank=round(pagerank.get(node, 0.0), 6),
                betweenness=0.0,
                degree=0.0,
                eigenvector=round(eigenvector.get(node, 0.0), 6),
                composite=0.0,
                role=GraphRole.EXECUTOR,
            )
            continue

        raw = sum(
            zs[k][node] * CENTRALITY_WEIGHTS[k]
            for k in CENTRALITY_WEIGHTS
        )

        # Convert the relative network-centrality score into 0..100.
        score = round(_sigmoid(raw) * 100, 2)

        role = (
            GraphRole.KINGPIN
            if score > 70
            else GraphRole.BROKER
            if score >= 40
            else GraphRole.EXECUTOR
        )

        rows[node] = KingpinScoreRow(
            entity_id=node,
            label="",
            pagerank=round(pagerank.get(node, 0.0), 6),
            betweenness=round(betweenness.get(node, 0.0), 6),
            degree=round(degree.get(node, 0.0), 6),
            eigenvector=round(eigenvector.get(node, 0.0), 6),
            composite=score,
            role=role,
        )

    return rows


def analyze(case_id: str, entities: list[dict[str, Any]], relations: list[dict[str, Any]]) -> NetworkGraph:
    """Full pipeline: build graph -> score -> serialize to NetworkGraph schema."""
    g, meta = build_graph(case_id, entities, relations)
    scores = compute_kingpin_scores(g)

    nodes: list[GraphNode] = []
    for nid in g.nodes:
        s = scores.get(nid)
        m = meta.get(nid, {})
        nodes.append(
            GraphNode(
                id=nid,
                label=m.get("label", nid),
                entity_type=m.get("entity_type", "PERSON"),
                kingpin_score=s.composite if s else 0.0,
                role=s.role if s else GraphRole.EXECUTOR,
                centrality={
                    "pagerank": s.pagerank if s else 0.0,
                    "betweenness": s.betweenness if s else 0.0,
                    "degree": s.degree if s else 0.0,
                    "eigenvector": s.eigenvector if s else 0.0,
                },
            )
        )

    edges: list[GraphEdge] = []
    for u, v, data in g.edges(data=True):
        try:
            rel = RelationType(data.get("relation", "associate"))
        except ValueError:
            rel = RelationType.ASSOCIATE
        edges.append(
            GraphEdge(
                source=u,
                target=v,
                relation=rel,
                weight=float(data.get("weight", 1.0)),
                evidence="; ".join(data.get("evidence", [])[:3]),
            )
        )

    # Network-level metrics for the analytics dashboard
    metrics = {
        "node_count": g.number_of_nodes(),
        "edge_count": g.number_of_edges(),
        "density": round(nx.density(g), 4),
        "connected_components": nx.number_weakly_connected_components(g),
        "kingpins": [n.label for n in nodes if n.role == GraphRole.KINGPIN],
        "brokers": [n.label for n in nodes if n.role == GraphRole.BROKER],
        "avg_clustering": round(nx.average_clustering(g.to_undirected()), 4),
    }
    return NetworkGraph(case_id=case_id, nodes=nodes, edges=edges, metrics=metrics)


def community_detection(g: nx.Graph) -> dict[str, int]:
    """Louvain-style community detection via greedy modularity (NetworkX)."""
    try:
        from networkx.algorithms.community import greedy_modularity_communities

        communities = greedy_modularity_communities(g)
        return {node: i for i, comm in enumerate(communities) for node in comm}
    except Exception:
        return {}
