"""Pattern Detection Agent — Isolation Forest + DBSCAN via LangGraph."""
from __future__ import annotations

import logging
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from app.services.cluster_analyzer import cluster_suspects, detect_anomalies

logger = logging.getLogger("crimenetx.agents.pattern")


class PatternAgentState(TypedDict, total=False):
    case_id: str
    transactions: list[dict[str, Any]]
    suspects: list[dict[str, Any]]
    anomalies: list[dict[str, Any]]
    clusters: list[dict[str, Any]]


def _detect_anomalies(state: PatternAgentState) -> PatternAgentState:
    txns = state.get("transactions", [])
    anomalies = detect_anomalies(txns)
    return {"anomalies": [a.model_dump() for a in anomalies]}


def _cluster(state: PatternAgentState) -> PatternAgentState:
    suspects = state.get("suspects", [])
    # Build simple behavior vectors from txn frequency + avg amount.
    features = []
    for s in suspects:
        sid = s.get("id", "")
        txns_s = [t for t in state.get("transactions", []) if t.get("from_account") == sid or t.get("to_account") == sid]
        avg = sum(float(t.get("amount", 0)) for t in txns_s) / max(1, len(txns_s))
        features.append({"id": sid, "vector": [len(txns_s), avg, s.get("kingpin_score", 0.0)]})
    clusters = cluster_suspects(features)
    return {"clusters": [c.model_dump() for c in clusters]}


def build_pattern_agent():
    g = StateGraph(PatternAgentState)
    g.add_node("detect_anomalies", _detect_anomalies)
    g.add_node("cluster", _cluster)
    g.set_entry_point("detect_anomalies")
    g.add_edge("detect_anomalies", "cluster")
    g.add_edge("cluster", END)
    return g.compile()
