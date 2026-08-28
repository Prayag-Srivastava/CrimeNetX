"""Kingpin Analysis Agent — runs NetworkX centrality algorithms via LangGraph."""
from __future__ import annotations

import logging
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from app.services.graph_analyzer import build_graph, compute_kingpin_scores

logger = logging.getLogger("crimenetx.agents.kingpin")


class KingpinAgentState(TypedDict, total=False):
    case_id: str
    entities: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    scores: list[dict[str, Any]]


def _score(state: KingpinAgentState) -> KingpinAgentState:
    g, meta = build_graph(state.get("case_id", ""), state.get("entities", []), state.get("relations", []))
    scores = compute_kingpin_scores(g)
    rows = []
    for nid, s in scores.items():
        m = meta.get(nid, {})
        rows.append(
            {
                "entity_id": nid,
                "label": m.get("label", nid),
                "pagerank": s.pagerank,
                "betweenness": s.betweenness,
                "degree": s.degree,
                "eigenvector": s.eigenvector,
                "composite": s.composite,
                "role": s.role.value,
            }
        )
    return {"scores": rows}


def build_kingpin_agent():
    g = StateGraph(KingpinAgentState)
    g.add_node("score", _score)
    g.set_entry_point("score")
    g.add_edge("score", END)
    return g.compile()
