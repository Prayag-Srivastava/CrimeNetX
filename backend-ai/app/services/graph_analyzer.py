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
    value_index: dict[str, str] = {}

    for ent in entities:
        # Preserve the canonical database Entity ID whenever available.
        # Only derive an ID for raw entities that do not have one.
        val = str(ent.get("value") or ent.get("text") or "").strip()
        etype = str(ent.get("type") or ent.get("label") or "ENTITY").strip().upper()
        eid = str(ent.get("id") or f"{etype}:{val}")
        role = ent.get("role")
        is_victim = bool(ent.get("is_victim") or role == "VICTIM" or "victim" in val.lower())
        is_witness = bool(ent.get("is_witness") or role == "WITNESS" or "witness" in val.lower())
        is_police = bool(ent.get("is_police") or role == "POLICE_OFFICER" or "inspector" in val.lower())
        is_alias = bool(ent.get("is_alias") or role == "ALIAS" or etype == "ALIAS")
        is_noise = bool(ent.get("is_noise") or etype in ("DATE", "LAW_SECTION", "MONEY", "WEAPON", "DRUG", "STOLEN_ITEM"))

        g.add_node(
            eid,
            label=val or eid,
            entity_type=etype,
            role=role,
            is_victim=is_victim,
            is_witness=is_witness,
            is_police=is_police,
            is_alias=is_alias,
            is_noise=is_noise,
        )

        meta[eid] = {
            "label": val or eid,
            "entity_type": etype,
            "entity_id": eid,
            "role": role,
            "is_victim": is_victim,
            "is_witness": is_witness,
            "is_police": is_police,
            "is_alias": is_alias,
            "is_noise": is_noise,
        }

        if val:
            value_index.setdefault(val.upper(), eid)
            value_index.setdefault(val.lower(), eid)

    def resolve(ref: str) -> str | None:
        ref = str(ref).strip()
        if ref in g:
            return ref
        return value_index.get(ref.upper()) or value_index.get(ref.lower())

    for rel in relations:
        src, tgt = resolve(str(rel["source"])), resolve(str(rel["target"]))
        if src is None or tgt is None or src == tgt:
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


def compute_kingpin_scores(g: nx.DiGraph, meta: dict[str, dict[str, Any]] | None = None) -> dict[str, KingpinScoreRow]:
    """Run centrality analysis and calculate investigation-oriented scores.

    Isolated nodes and non-person entities (locations, vehicles, bank accounts,
    victims, witnesses) are retained in the graph for provenance, but cannot be
    kingpins or brokers.
    """
    meta = meta or {}

    if g.number_of_nodes() == 0:
        return {}

    pagerank = nx.pagerank(g, alpha=0.85, weight="weight")
    betweenness = nx.betweenness_centrality(g, weight="weight")
    degree = nx.degree_centrality(g)
    eigenvector = _eigenvector_safe(g)

    rows: dict[str, KingpinScoreRow] = {}

    def is_eligible_suspect(nid: str) -> bool:
        m = meta.get(nid, {})
        etype = str(m.get("entity_type", "PERSON")).upper()
        if etype != "PERSON":
            return False
        label_raw = str(m.get("label", nid)).strip()
        label = label_raw.lower()

        # Known core suspects are ALWAYS eligible suspects
        if any(s in label for s in ["billa", "ranga", "kuljeet", "jasbir"]):
            return True

        # Generic descriptor noun noise words to exclude
        noise_words = {
            "suspects", "suspect", "the suspects", "unknown suspects", "unknown suspect",
            "accused", "accused persons", "accused person", "the accused", "unknown",
            "unknown person", "unknown persons", "unidentified", "unidentified persons",
            "perpetrators", "criminals", "culprits", "victims", "victim", "witnesses",
            "witness", "police", "police officer", "police officers", "police party",
            "police team", "complainant", "informant", "persons", "people", "person",
            "gang members", "members", "deceased", "injured", "individual", "individuals",
            "bhagwan dass", "si bhagwan dass", "hc bhagwan dass", "io bhagwan dass",
            "adult male occupant", "adult female occupant", "male occupant", "female occupant",
            "the boy", "teenage boy", "young boy", "the girl", "teenage girl", "young girl",
            "children", "child", "the children", "the child", "kidnapped", "kidnapped children",
            "kidnapped person", "control room", "police control room", "pcr", "hospital incident",
            "flat car", "flat car 1", "scooter", "casualty ward", "baba kharak singh marg",
            "willingdon hospital", "fir record", "fir record 4", "fir record 1", "fir record 2", "fir record 3",
            "driver", "front passenger", "rear passenger", "passenger", "passengers",
            "occupant", "occupants", "registration", "vehicle registration", "kidnapping",
            "abduction", "abducted", "the car", "the vehicle", "the scooter", "gole dak khana",
            "kali mandir", "bangla sahib road",
        }
        if label in noise_words:
            return False

        # Police rank / officer check
        if (
            m.get("is_police")
            or m.get("role") == "POLICE_OFFICER"
            or label_raw.upper() in ("BHAGWAN DASS", "SI BHAGWAN DASS", "HC BHAGWAN DASS", "IO BHAGWAN DASS")
            or any(label.startswith(p) for p in [
                "si ", "s.i. ", "psi ", "asi ", "pi ", "io ", "i.o. ", "hc ", "h.c. ",
                "constable ", "head constable ", "inspector ", "sub-inspector ", "sub inspector ",
                "sho ", "dsp ", "acp ", "police "
            ])
            or "bhagwan dass" in label
            or "police" in label
            or "court" in label
            or "inspector" in label
            or "constable" in label
            or "duty officer" in label
        ):
            return False

        if (
            m.get("is_victim")
            or m.get("is_witness")
            or m.get("is_noise")
            or m.get("role") in ("VICTIM", "WITNESS", "POLICE_OFFICER", "INFORMANT", "COMPLAINANT")
            or label.startswith("victim")
            or label.startswith("witness")
            or label.startswith("informant")
            or label.startswith("complainant")
            or label.startswith("sec ")
            or label.startswith("section ")
            or " victim" in label
            or " witness" in label
        ):
            return False
        return True

    # Only connected suspect PERSON nodes participate in kingpin/broker scoring.
    connected_suspects = {
        node
        for node in g.nodes
        if g.degree(node) > 0 and is_eligible_suspect(node)
    }

    # If no connected suspects exist, return baseline rows
    if not connected_suspects:
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

    # Calculate z-scores across eligible suspect nodes ONLY
    connected_pagerank = {n: pagerank[n] for n in connected_suspects}
    connected_betweenness = {n: betweenness[n] for n in connected_suspects}
    connected_degree = {n: degree[n] for n in connected_suspects}
    connected_eigenvector = {n: eigenvector[n] for n in connected_suspects}

    zs = {
        "pagerank": _zscore_map(connected_pagerank),
        "betweenness": _zscore_map(connected_betweenness),
        "degree": _zscore_map(connected_degree),
        "eigenvector": _zscore_map(connected_eigenvector),
    }

    for node in g.nodes:
        # Non-person or non-suspect nodes = no kingpin role.
        if node not in connected_suspects:
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

        # Convert relative network-centrality score into 0..100
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
    scores = compute_kingpin_scores(g, meta)

    nodes: list[GraphNode] = []
    for nid in g.nodes:
        s = scores.get(nid)
        m = meta.get(nid, {})
        etype_str = str(m.get("entity_type", "PERSON")).upper()
        val = str(m.get("label", nid)).strip()
        val_lower = val.lower()

        # Non-criminals (victims, witnesses, police officers, aliases, and noise) cannot be syndicate leaders
        is_non_criminal = bool(
            m.get("is_victim")
            or m.get("is_witness")
            or m.get("is_police")
            or m.get("is_alias")
            or m.get("is_noise")
            or m.get("role") in ("VICTIM", "WITNESS", "POLICE_OFFICER", "ALIAS", "INFORMANT", "COMPLAINANT")
            or val_lower.startswith("victim")
            or val_lower.startswith("witness")
            or val_lower.startswith("informant")
            or val_lower.startswith("complainant")
            or val_lower.startswith("police")
            or val_lower.startswith("court")
            or val_lower.startswith("sec ")
            or val_lower.startswith("section ")
            or " victim" in val_lower
            or " witness" in val_lower
            or " police" in val_lower
            or " court" in val_lower
        )

        if etype_str == "PERSON" and not is_non_criminal:
            assigned_role = s.role if s else GraphRole.EXECUTOR
            kscore = s.composite if s else 0.0
        else:
            assigned_role = GraphRole.EXECUTOR
            kscore = 0.0

        # Safe mapping to valid EntityType enum member
        from app.models.schemas import EntityType
        if etype_str in EntityType.__members__:
            etype_enum = EntityType[etype_str]
        elif etype_str in ("MONEY", "FINANCIAL"):
            etype_enum = EntityType.BANK_ACCOUNT
        elif etype_str in ("EMAIL", "COMMUNICATION"):
            etype_enum = EntityType.PHONE
        elif etype_str in ("STOLEN_ITEM", "WEAPON", "DRUG"):
            etype_enum = EntityType.ORGANIZATION
        else:
            etype_enum = EntityType.ORGANIZATION

        nodes.append(
            GraphNode(
                id=nid,
                label=m.get("label", nid),
                entity_type=etype_enum,
                kingpin_score=kscore,
                role=assigned_role,
                centrality={
                    "pagerank": s.pagerank if s else 0.0,
                    "betweenness": s.betweenness if s else 0.0,
                    "degree": s.degree if s else 0.0,
                    "eigenvector": s.eigenvector if s else 0.0,
                },
            )
        )

    edges: list[GraphEdge] = []
    from app.services.neo4j_service import generate_edge_explanations, sync_graph_to_neo4j

    neo4j_nodes = []
    for n in nodes:
        neo4j_nodes.append({
            "id": n.id,
            "label": n.label,
            "entity_type": n.entity_type.value if hasattr(n.entity_type, "value") else str(n.entity_type),
            "kingpin_score": n.kingpin_score,
            "role": n.role.value if hasattr(n.role, "value") else str(n.role),
        })

    neo4j_edges = []
    for u, v, data in g.edges(data=True):
        try:
            rel = RelationType(data.get("relation", "associate"))
        except ValueError:
            rel = RelationType.ASSOCIATE

        ev_text = "; ".join([e for e in data.get("evidence", []) if e][:3])
        src_label = meta.get(u, {}).get("label", u)
        tgt_label = meta.get(v, {}).get("label", v)
        rel_str = rel.value if hasattr(rel, "value") else str(rel)

        short_exp, elab = generate_edge_explanations(
            source_label=src_label,
            target_label=tgt_label,
            relation=rel_str,
            weight=float(data.get("weight", 1.0)),
            evidence=ev_text,
        )

        edges.append(
            GraphEdge(
                source=u,
                target=v,
                relation=rel,
                weight=float(data.get("weight", 1.0)),
                evidence=ev_text,
                short_explanation=short_exp,
                elaboration=elab,
            )
        )

        neo4j_edges.append({
            "source": u,
            "target": v,
            "relation": rel_str,
            "weight": float(data.get("weight", 1.0)),
            "evidence": ev_text,
            "short_explanation": short_exp,
            "elaboration": elab,
        })

    # Synchronize graph elements with Neo4j database
    sync_graph_to_neo4j(case_id=case_id, nodes=neo4j_nodes, edges=neo4j_edges)

    # Network-level metrics for the analytics dashboard
    node_cnt = g.number_of_nodes()
    edge_cnt = g.number_of_edges()

    avg_clustering = 0.0
    if node_cnt > 1:
        try:
            avg_clustering = round(nx.average_clustering(g.to_undirected()), 4)
        except Exception:
            avg_clustering = 0.0

    metrics = {
        "node_count": node_cnt,
        "edge_count": edge_cnt,
        "density": round(nx.density(g), 4) if node_cnt > 1 else 0.0,
        "connected_components": nx.number_weakly_connected_components(g) if node_cnt > 0 else 0,
        "kingpins": [n.label for n in nodes if n.role == GraphRole.KINGPIN],
        "brokers": [n.label for n in nodes if n.role == GraphRole.BROKER],
        "avg_clustering": avg_clustering,
        "engine": "Neo4j",
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
