"""LangGraph Multi-Agent Supervisor — orchestrates the full case analysis.

Graph topology:

            ┌──────────────────────────────────────────────┐
            │                   SUPERVISOR                 │
            │  - receives case payload, routes to agents   │
            │  - decides ordering via conditional edge     │
            └───────┬──────────────┬───────────────┬───────┘
                    │              │               │
        ┌───────────▼──┐   ┌───────▼───────┐   ┌───▼──────────┐
        │ ENTITY AGENT │   │ PATTERN AGENT │   │ KINGPIN AGENT│
        │ (spaCy+regex │   │ (IF+DBSCAN)   │   │ (centrality) │
        │  +Groq)      │   └───────┬───────┘   └───┬──────────┘
        └───────────┬──┘           │               │
                    │              │               │
                    └──────┬───────┴───────┬───────┘
                           │               │
                    ┌──────▼──────┐  ┌─────▼─────────┐
                    │ CROSS-REF   │  │  REPORT NODE  │  -> END
                    └─────────────┘  └───────────────┘

Conditional edges: supervisor routes to agent sub-graphs based on payload;
the report node is only reached after analytics are done (router function).
State checkpointing uses InMemorySaver (production would swap in Postgres).
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Literal, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, StateGraph

from app.agents.entity_agent import build_entity_agent
from app.agents.kingpin_agent import build_kingpin_agent
from app.agents.pattern_agent import build_pattern_agent
from app.models.schemas import AgentEvent
from app.services.cross_reference import cross_reference
from app.services.mo_fingerprint import extract_mo_features

logger = logging.getLogger("crimenetx.agents.supervisor")


class SuperState(TypedDict, total=False):
    case_id: str
    case_number: str
    fir_text: str
    transactions: list[dict[str, Any]]
    suspects: list[dict[str, Any]]
    entities: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    anomalies: list[dict[str, Any]]
    clusters: list[dict[str, Any]]
    scores: list[dict[str, Any]]
    cross_refs: list[dict[str, Any]]
    mo_features: dict[str, Any]
    report: dict[str, Any]
    events: list[AgentEvent]


def _emit(state: SuperState, etype: str, node: str, message: str, data: dict | None = None) -> dict[str, list[AgentEvent]]:
    """Record an event — RETURNS the state update (LangGraph requires nodes to
    return their state changes; in-place mutation of the input copy is lost)."""
    evt = AgentEvent(type=etype, node=node, message=message, data=data or {})
    return {"events": state.get("events", []) + [evt]}


# ---------------------------------------------------------------------------
# Supervisor nodes
# ---------------------------------------------------------------------------
def supervisor_node(state: SuperState) -> SuperState:
    return _emit(state, "agent", "supervisor", "Supervisor received case payload — routing to Entity Agent")


def entity_node(state: SuperState) -> SuperState:
    updates = _emit(state, "agent", "entity", "Entity Agent: running spaCy + regex + Groq extraction…")
    # Deterministic inline extraction (sub-graph graph state sharing is simpler
    # to keep synchronous; the pipeline is identical to entity_agent's).
    from app.services.nlp_extractor import extract_entities

    result = extract_entities(state.get("fir_text", ""), state.get("case_number", "case"), state.get("case_id"))
    updates.update(_emit(state, "progress", "entity", f"Extracted {len(result.entities)} entities, {len(result.relations)} relations", {"count": len(result.entities)}))
    updates.update(
        {
            "entities": [e.model_dump() for e in result.entities],
            "relations": result.relations,
        }
    )
    return updates


def pattern_node(state: SuperState) -> SuperState:
    updates = _emit(state, "agent", "pattern", "Pattern Agent: Isolation Forest + DBSCAN…")
    from app.services.cluster_analyzer import cluster_suspects, detect_anomalies

    txns = state.get("transactions", [])
    anomalies = [a.model_dump() for a in detect_anomalies(txns)] if txns else []
    features = [
        {
            "id": s.get("id", ""),
            "vector": [
                sum(1 for t in txns if t.get("from_account") == s.get("id")),
                s.get("kingpin_score", 0.0),
            ],
        }
        for s in state.get("suspects", [])
    ]
    clusters = [c.model_dump() for c in cluster_suspects(features)] if features else []
    updates.update(_emit(state, "progress", "pattern", f"Found {sum(1 for a in anomalies if a['is_anomaly'])} anomalies, {len(clusters)} clusters"))
    updates.update({"anomalies": anomalies, "clusters": clusters})
    return updates


def kingpin_node(state: SuperState) -> SuperState:
    updates = _emit(state, "agent", "kingpin", "Kingpin Agent: computing PageRank / Betweenness / Degree / Eigenvector…")
    from app.services.graph_analyzer import build_graph, compute_kingpin_scores

    g, meta = build_graph(state.get("case_id", ""), state.get("entities", []), state.get("relations", []))
    scores = compute_kingpin_scores(g)
    rows = [
        {
            "entity_id": nid,
            "label": meta.get(nid, {}).get("label", nid),
            "pagerank": s.pagerank,
            "betweenness": s.betweenness,
            "degree": s.degree,
            "eigenvector": s.eigenvector,
            "composite": s.composite,
            "role": s.role.value,
        }
        for nid, s in scores.items()
    ]
    kingpins = [r for r in rows if r["role"] == "KINGPIN"]
    updates.update(_emit(state, "progress", "kingpin", f"Computed scores for {len(rows)} nodes; {len(kingpins)} kingpins identified"))
    updates.update({"scores": rows})
    return updates


def cross_ref_node(state: SuperState) -> SuperState:
    updates = _emit(state, "agent", "cross-ref", "Cross-Reference Agent: querying ChromaDB for similar cases…")
    result = cross_reference(state.get("case_id", ""), state.get("fir_text", ""), state.get("entities", []))
    updates.update(_emit(state, "progress", "cross-ref", f"Found {len(result.matches)} linked cases"))
    updates.update({"cross_refs": [m.model_dump() for m in result.matches]})
    return updates


def mo_node(state: SuperState) -> SuperState:
    updates = _emit(state, "agent", "mo", "MO Fingerprint Agent: extracting modus operandi via Groq…")
    mo = extract_mo_features(state.get("fir_text", ""))
    updates.update(_emit(state, "progress", "mo", "MO features extracted", mo.model_dump()))
    updates.update({"mo_features": mo.model_dump()})
    return updates


def report_node(state: SuperState) -> SuperState:
    updates = _emit(state, "agent", "report", "Compiling final analysis report…")
    report = {
        "summary": f"Analysis complete for case {state.get('case_number', state.get('case_id', ''))}.",
        "entity_count": len(state.get("entities", [])),
        "kingpin_count": sum(1 for s in state.get("scores", []) if s.get("role") == "KINGPIN"),
        "anomaly_count": sum(1 for a in state.get("anomalies", []) if a.get("is_anomaly")),
        "cluster_count": len({c.get("cluster") for c in state.get("clusters", []) if c.get("cluster", -1) >= 0}),
        "linked_cases": [m.get("case_id") for m in state.get("cross_refs", [])],
        "mo": state.get("mo_features", {}),
    }
    updates.update(_emit(state, "result", "report", "Report ready", report))
    updates.update({"report": report})
    return updates


# ---------------------------------------------------------------------------
# Conditional routing
# ---------------------------------------------------------------------------
def after_entity_router(state: SuperState) -> Literal["pattern", "kingpin", "cross_ref", "mo"]:
    """Route based on payload — all branches converge on the report node."""
    if state.get("transactions") or state.get("suspects"):
        return "pattern"
    return "kingpin"


def build_supervisor_graph():
    """Assemble + compile the supervisor graph with an InMemorySaver checkpoint."""
    g = StateGraph(SuperState)

    g.add_node("supervisor", supervisor_node)
    g.add_node("entity", entity_node)
    g.add_node("pattern", pattern_node)
    g.add_node("kingpin", kingpin_node)
    g.add_node("cross_ref", cross_ref_node)
    g.add_node("mo", mo_node)
    g.add_node("report", report_node)

    g.set_entry_point("supervisor")
    g.add_edge("supervisor", "entity")
    g.add_conditional_edges(
        "entity",
        after_entity_router,
        {"pattern": "pattern", "kingpin": "kingpin"},
    )
    g.add_edge("pattern", "kingpin")
    g.add_edge("kingpin", "cross_ref")
    g.add_edge("cross_ref", "mo")
    g.add_edge("mo", "report")
    g.add_edge("report", END)

    # InMemorySaver = checkpointing for short-lived runs; swap for Postgres
    # (SqliteSaver/PostgresSaver) when runs must survive restarts.
    return g.compile(checkpointer=InMemorySaver())


def run_analysis(payload: dict[str, Any]) -> list[AgentEvent]:
    """Run the full supervisor graph synchronously and return emitted events."""
    graph = build_supervisor_graph()
    config = {"configurable": {"thread_id": f"case-{payload.get('case_id', int(time.time()))}"}}
    final = graph.invoke(payload, config)
    return final.get("events", [])


async def run_analysis_stream(payload: dict[str, Any]):
    """Async generator yielding SSE-formatted progress events."""
    graph = build_supervisor_graph()
    config = {"configurable": {"thread_id": f"case-{payload.get('case_id', int(time.time()))}"}}

    try:
        # First event — kickoff
        yield AgentEvent(type="start", node="supervisor", message=f"Analysis started for case {payload.get('case_number', payload.get('case_id', ''))}")
        # Run in executor to avoid blocking the event loop (LangGraph is sync here).
        loop = asyncio.get_event_loop()
        final = await loop.run_in_executor(None, graph.invoke, payload, config)
        for evt in final.get("events", []):
            yield evt
        yield AgentEvent(type="complete", node="supervisor", message="Analysis complete")
    except Exception as exc:  # pragma: no cover
        logger.exception("supervisor run failed")
        yield AgentEvent(type="error", node="supervisor", message=f"Analysis failed: {exc}")
