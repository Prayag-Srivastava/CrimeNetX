"""Entity Extraction Agent — orchestrates spaCy + regex + Groq via LangGraph.

This agent is a reusable sub-graph: it receives raw FIR text, runs the
three-layer extraction pipeline, and returns validated entities/relations.
"""
from __future__ import annotations

import logging
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from app.services.nlp_extractor import extract_entities

logger = logging.getLogger("crimenetx.agents.entity")


class EntityAgentState(TypedDict, total=False):
    case_id: str
    fir_text: str
    source_name: str
    entities: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    llm_used: bool


def _extract(state: EntityAgentState) -> EntityAgentState:
    """Node 1: run the 3-layer extraction pipeline."""
    result = extract_entities(state.get("fir_text", ""), state.get("source_name", "agent"))
    return {
        "entities": [e.model_dump() for e in result.entities],
        "relations": result.relations,
        "llm_used": result.llm_used,
    }


def _dedupe(state: EntityAgentState) -> EntityAgentState:
    """Node 2: dedupe + sort entities (stability for graph building)."""
    ents = state.get("entities", [])
    best: dict[tuple[str, str], dict[str, Any]] = {}
    for e in ents:
        key = (e["type"], e["value"].upper())
        if key not in best or e["confidence"] > best[key]["confidence"]:
            best[key] = e
    return {"entities": sorted(best.values(), key=lambda x: (x["type"], x["value"]))}


def build_entity_agent():
    """Build the entity extraction sub-graph (reusable by the supervisor)."""
    g = StateGraph(EntityAgentState)
    g.add_node("extract", _extract)
    g.add_node("dedupe", _dedupe)
    g.set_entry_point("extract")
    g.add_edge("extract", "dedupe")
    g.add_edge("dedupe", END)
    return g.compile()
