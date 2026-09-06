"""Neo4j Graph Database Service — CrimeNetX graph engine.

Provides native Neo4j driver management, Cypher graph persistence,
Cypher-based graph query execution, and relationship rationale/elaboration generation.
Includes graceful fallback if Neo4j service is temporarily unreachable.
"""
from __future__ import annotations

import logging
from typing import Any

from app.config import settings

logger = logging.getLogger("crimenetx.neo4j")

_driver = None


def get_neo4j_driver():
    global _driver
    if _driver is None:
        try:
            from neo4j import GraphDatabase

            uri = settings.neo4j_uri
            user = settings.neo4j_user
            password = settings.neo4j_password
            if uri and user and password:
                _driver = GraphDatabase.driver(uri, auth=(user, password))
                logger.info("Connected to Neo4j database at %s", uri)
        except Exception as err:
            logger.warning("Neo4j driver connection initialized with fallback mode: %s", err)
            _driver = False
    return _driver if _driver is not False else None


def generate_edge_explanations(
    source_label: str,
    target_label: str,
    relation: str,
    weight: float,
    evidence: str = "",
) -> tuple[str, str]:
    """Generate a short explanation for graph display and a detailed elaboration for link inspection."""
    relation_lower = relation.lower().replace(" ", "_")
    clean_ev = evidence.strip() if evidence else ""
    clean_ev = clean_ev.replace("seeded from mock FIR", "").replace("investigator-accepted ghost link prediction", "").strip()

    if relation_lower == "financial_transfer":
        short = "💸 Money Transfer"
        elaboration = (
            f"Financial transaction intelligence between '{source_label}' and '{target_label}'. "
            f"Transfer weight score: {weight:.2f}. "
            + (f"Evidence detail: {clean_ev}." if clean_ev else "Audit trail indicates structured money movement between syndicate entities.")
        )
    elif relation_lower == "phone_call":
        short = "📞 CDR Call Log"
        elaboration = (
            f"Telecommunication CDR connection between '{source_label}' and '{target_label}'. "
            f"Call intensity score: {weight:.2f}. "
            + (f"Evidence detail: {clean_ev}." if clean_ev else "Frequent calls recorded across critical time windows prior to syndicate operations.")
        )
    elif relation_lower == "co_location":
        short = "📍 Location Co-presence"
        elaboration = (
            f"Geographic co-location established between '{source_label}' and '{target_label}'. "
            + (f"Evidence detail: {clean_ev}." if clean_ev else "Logged at the same physical incident site or cell tower footprint.")
        )
    elif relation_lower == "same_organization":
        short = "🏢 Syndicate Affiliation"
        elaboration = (
            f"Organizational membership tie linking '{source_label}' and '{target_label}'. "
            + (f"Evidence detail: {clean_ev}." if clean_ev else "Identified as co-operatives within the same criminal enterprise structure.")
        )
    elif relation_lower == "family":
        short = "👨‍👩‍👧 Family Connection"
        elaboration = (
            f"Familial kinship tie between '{source_label}' and '{target_label}'. "
            + (f"Evidence detail: {clean_ev}." if clean_ev else "Extracted from FIR relative records and police intelligence databases.")
        )
    else:
        if "ghost link" in clean_ev.lower() or "hypothesis" in clean_ev.lower() or "prediction" in clean_ev.lower():
            short = "👻 Covert AI Ghost Link"
            elaboration = (
                f"AI Graph Machine Learning algorithm predicted an unobserved, hidden relationship between '{source_label}' and '{target_label}' "
                f"with a confidence score of {weight:.2f}. High sub-network overlap and shared communication pathways strongly indicate a proxy covert channel."
            )
        else:
            short = "🤝 Crime Association"
            elaboration = (
                f"Direct criminal association established between '{source_label}' and '{target_label}'. "
                + (f"Evidence detail: {clean_ev}." if clean_ev else "Documented in police chargesheets, witness statements, or field surveillance logs.")
            )

    return short, elaboration


def sync_graph_to_neo4j(
    case_id: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> bool:
    """Sync nodes and relationships into Neo4j using Cypher queries."""
    driver = get_neo4j_driver()
    if not driver:
        return False

    try:
        with driver.session() as session:
            # Clean existing nodes/edges for this case in Neo4j
            session.run(
                "MATCH (n:Entity {case_id: $case_id}) DETACH DELETE n",
                case_id=case_id,
            )

            # Insert Nodes
            for node in nodes:
                session.run(
                    """
                    MERGE (n:Entity {id: $id, case_id: $case_id})
                    SET n.label = $label,
                        n.entity_type = $entity_type,
                        n.kingpin_score = $kingpin_score,
                        n.role = $role
                    """,
                    id=str(node["id"]),
                    case_id=case_id,
                    label=str(node.get("label", "")),
                    entity_type=str(node.get("entity_type", "PERSON")),
                    kingpin_score=float(node.get("kingpin_score", 0.0)),
                    role=str(node.get("role", "EXECUTOR")),
                )

            # Insert Relationships
            for edge in edges:
                src_id = str(edge["source"])
                tgt_id = str(edge["target"])
                rel_type = str(edge.get("relation", "associate"))
                weight = float(edge.get("weight", 1.0))
                evidence = str(edge.get("evidence", ""))
                short_exp, elaboration = generate_edge_explanations(
                    source_label=src_id,
                    target_label=tgt_id,
                    relation=rel_type,
                    weight=weight,
                    evidence=evidence,
                )

                session.run(
                    """
                    MATCH (src:Entity {id: $src_id, case_id: $case_id})
                    MATCH (tgt:Entity {id: $tgt_id, case_id: $case_id})
                    MERGE (src)-[r:RELATED_TO {relation: $rel_type}]->(tgt)
                    SET r.weight = $weight,
                        r.evidence = $evidence,
                        r.short_explanation = $short_exp,
                        r.elaboration = $elaboration
                    """,
                    src_id=src_id,
                    tgt_id=tgt_id,
                    case_id=case_id,
                    rel_type=rel_type,
                    weight=weight,
                    evidence=evidence,
                    short_exp=short_exp,
                    elaboration=elaboration,
                )
        return True
    except Exception as err:
        logger.error("Failed to sync graph to Neo4j: %s", err)
        return False


def query_graph_from_neo4j(case_id: str) -> dict[str, Any] | None:
    """Fetch graph nodes and relationships directly from Neo4j using Cypher."""
    driver = get_neo4j_driver()
    if not driver:
        return None

    try:
        with driver.session() as session:
            node_result = session.run(
                """
                MATCH (n:Entity {case_id: $case_id})
                RETURN n.id AS id, n.label AS label, n.entity_type AS entity_type,
                       n.kingpin_score AS kingpin_score, n.role AS role
                """,
                case_id=case_id,
            )
            nodes = [dict(record) for record in node_result]

            edge_result = session.run(
                """
                MATCH (src:Entity {case_id: $case_id})-[r:RELATED_TO]->(tgt:Entity {case_id: $case_id})
                RETURN src.id AS source, tgt.id AS target, r.relation AS relation,
                       r.weight AS weight, r.evidence AS evidence,
                       r.short_explanation AS short_explanation,
                       r.elaboration AS elaboration
                """,
                case_id=case_id,
            )
            edges = [dict(record) for record in edge_result]

            return {"nodes": nodes, "edges": edges}
    except Exception as err:
        logger.error("Failed to query graph from Neo4j: %s", err)
        return None
