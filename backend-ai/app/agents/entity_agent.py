"""Entity Extraction Agent — full 5-stage forensic pipeline via LangGraph.

v2.2 — NOW DELEGATES TO ForensicPipeline
=========================================
WHAT WAS WRONG
--------------
The old agent called `extract_entities(fir_text)` directly. That function
starts at spaCy, so the agent silently skipped THREE of the five stages:

    Stage 1 OCR .............. MISSING (state only accepted `fir_text: str`)
    Stage 2 Translation ...... MISSING (raw Devanagari went into spaCy)
    Stage 3 NER .............. ok
    Stage 4 Resolution ....... MISSING (duplicate suspects never merged)
    Stage 5 Relationships .... ok

Result: Hindi entities in the UI, poor extraction quality, and no Splink
deduplication — while the standalone ForensicPipeline test looked fine
because it ran all five stages.

WHAT CHANGED
------------
The agent no longer reimplements anything. It routes to
`ForensicPipeline.process_document()` — the single canonical entry point —
so OCR -> translate -> NER -> Splink -> Groq all run with provenance
hashing and TextStorage, exactly once, in one place.

TWO INPUT MODES (auto-detected)
-------------------------------
  file_path present  -> FULL pipeline (Stages 1-5). Preferred.
  fir_text  present  -> TEXT pipeline (Stages 2-5). OCR skipped because
                        there is no document; translation still runs, so
                        Hindi input is handled correctly either way.

BACKWARD COMPATIBLE: `build_entity_agent()` and the `fir_text` state key
still work — existing supervisor code needs no change.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Optional, TypedDict

from langgraph.graph import END, StateGraph

logger = logging.getLogger("crimenetx.agents.entity")


class EntityAgentState(TypedDict, total=False):
    # ---- inputs ----
    case_id: str
    file_path: str            # NEW: triggers full pipeline incl. OCR
    fir_text: str             # legacy: text-only mode (Stages 2-5)
    source_name: str
    force_language: str       # NEW: investigator's manual language choice
    existing_entities: list[dict[str, Any]]   # NEW: for Splink resolution

    # ---- outputs ----
    entities: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    llm_used: bool

    # ---- NEW provenance / observability ----
    document_id: str
    ocr_text: str
    translated_text: str
    source_language: str
    was_translated: bool
    ocr_confidence: float
    resolution_summary: dict[str, Any]
    stage_errors: list[str]
    pipeline_mode: str        # "full" | "text"
    processing_time_seconds: float


# Reuse one pipeline instance — it holds spaCy, IndicTrans2 and Splink,
# all of which are expensive to construct per invocation.
_PIPELINE = None


def _get_pipeline():
    global _PIPELINE
    if _PIPELINE is None:
        from app.services.pipeline import ForensicPipeline
        _PIPELINE = ForensicPipeline()
    return _PIPELINE


def _resolution_to_dict(report) -> dict[str, Any]:
    """Flatten a Splink ResolutionReport into plain JSON-safe fields."""
    if report is None:
        return {}
    out: dict[str, Any] = {}
    for key in ("merges", "reviews", "total_comparisons", "auto_merged", "flagged"):
        if hasattr(report, key):
            out[key] = getattr(report, key)
    return out


# ================================================================
# Node 1a: FULL pipeline (OCR -> translate -> NER -> Splink -> Groq)
# ================================================================
def _run_full_pipeline(state: EntityAgentState) -> EntityAgentState:
    pipeline = _get_pipeline()
    file_path = state.get("file_path", "")
    case_id = state.get("case_id", "UNKNOWN")

    logger.info(f"[entity_agent] FULL pipeline for {file_path} (case={case_id})")

    result = pipeline.process_document(
        file_path=file_path,
        case_id=case_id,
        existing_entities=state.get("existing_entities") or [],
        force_language=state.get("force_language"),
    )

    entities = _normalize_entities(
        result.entities,
        source_name=state.get("source_name", "agent"),
        case_id=case_id,
    )

    if result.stage_errors:
        logger.warning(f"[entity_agent] stage errors: {result.stage_errors}")

    return {
        "entities": entities,
        "relations": result.relationships,
        "llm_used": _llm_was_used(result.relationships),
        "document_id": result.document_id,
        "ocr_text": result.ocr_text,
        "translated_text": result.translated_text,
        "source_language": result.source_language,
        "was_translated": result.was_translated,
        "ocr_confidence": result.ocr_confidence,
        "resolution_summary": _resolution_to_dict(result.resolution_report),
        "stage_errors": result.stage_errors,
        "pipeline_mode": "full",
        "processing_time_seconds": result.processing_time_seconds,
    }


# ================================================================
# Node 1b: TEXT pipeline (translate -> NER -> Splink -> Groq)
# ================================================================
def _run_text_pipeline(state: EntityAgentState) -> EntityAgentState:
    """
    No document to OCR, but we still run Stages 2-5 properly.
    Translation happens inside nlp_extractor.ensure_english(), so Hindi
    input is handled here too — this is the path that used to be broken.
    """
    import time

    from app.services.nlp_extractor import get_extractor

    start = time.time()
    raw_text = state.get("fir_text", "") or ""
    case_id = state.get("case_id", "UNKNOWN")
    source_name = state.get("source_name", "agent")
    stage_errors: list[str] = []

    logger.info(f"[entity_agent] TEXT pipeline ({len(raw_text)} chars, case={case_id})")

    extractor = get_extractor()

    # ---- Stage 2: translation (explicit, so we can report it) ----
    translated = raw_text
    source_language = "unknown"
    was_translated = False
    try:
        from app.services.language_detector import LanguageDetector
        from app.services.nlp_extractor import is_probably_english

        force_lang = state.get("force_language")
        detector = LanguageDetector()
        detection = (
            detector.from_force_language(force_lang) if force_lang
            else detector.detect(raw_text)
        )
        source_language = detection.language

        if not is_probably_english(raw_text):
            translated = extractor.ensure_english(raw_text)
            was_translated = translated is not raw_text
        logger.info(
            f"[entity_agent] language={source_language}, translated={was_translated}"
        )
    except Exception as e:
        stage_errors.append(f"Stage 2 error: {e}")
        translated = extractor.ensure_english(raw_text)

    # ---- Stages 3 + 5: NER and relationships ----
    entities: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    llm_used = False
    try:
        from app.services.nlp_extractor import extract_entities

        result = extract_entities(
            translated,
            source_name,
            case_id=case_id,
            already_english=True,
        )
        entities = [e.model_dump() for e in result.entities]
        relations = result.relations
        llm_used = result.llm_used
    except Exception as e:
        stage_errors.append(f"Stage 3/5 error: {e}")
        logger.error(f"[entity_agent] extraction failed: {e}")

    # ---- Stage 4: Splink entity resolution ----
    resolution_summary: dict[str, Any] = {}
    try:
        resolution_summary = _resolve_persons(
            entities,
            state.get("existing_entities") or [],
        )
    except Exception as e:
        stage_errors.append(f"Stage 4 error: {e}")
        logger.warning(f"[entity_agent] resolution skipped: {e}")

    return {
        "entities": entities,
        "relations": relations,
        "llm_used": llm_used,
        "translated_text": translated,
        "source_language": source_language,
        "was_translated": was_translated,
        "resolution_summary": resolution_summary,
        "stage_errors": stage_errors,
        "pipeline_mode": "text",
        "processing_time_seconds": round(time.time() - start, 2),
    }


def _resolve_persons(
    entities: list[dict[str, Any]],
    existing: list[dict[str, Any]],
) -> dict[str, Any]:
    """Run Splink over PERSON entities (the stage the old agent never had)."""
    from app.services.entity_resolver import EntityResolver

    persons = [
        e for e in entities
        if str(e.get("type", "")).upper().endswith("PERSON")
        or str(e.get("type", "")).upper() == "PERSON"
    ]
    if not persons:
        return {}

    payload = []
    for i, e in enumerate(persons):
        name = (e.get("value") or "").strip()
        parts = name.split()
        payload.append({
            "id": f"ent_{i}",
            "full_name": name,
            "first_name": parts[0] if parts else "",
            "last_name": parts[-1] if len(parts) > 1 else "",
            "phone": "",
            "father_name": "",
        })

    report = EntityResolver().resolve_entities(
        new_entities=payload,
        existing_entities=existing,
    )
    summary = _resolution_to_dict(report)
    logger.info(f"[entity_agent] Splink: {summary}")
    return summary


# ================================================================
# Router + shared nodes
# ================================================================
def _route(state: EntityAgentState) -> str:
    """Pick full vs text mode based on whether a document was supplied."""
    fp = state.get("file_path")
    if fp and Path(str(fp)).exists():
        return "full"
    if fp:
        logger.warning(f"[entity_agent] file_path not found: {fp} — using text mode")
    return "text"


def _normalize_entities(
    raw: list[dict[str, Any]],
    source_name: str,
    case_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """
    Convert ForensicPipeline's spaCy dicts ({text,label,start,end,...}) into
    the {type,value,confidence,...} shape the supervisor and graph builder
    already expect from the old agent.
    """
    from app.services.nlp_extractor import _LABEL_MAP, _SPACY_LAYER_LABELS

    out: list[dict[str, Any]] = []
    for item in raw:
        label = (item.get("label") or "").upper()
        value = (item.get("text") or "").strip()
        if not value:
            continue

        etype = _LABEL_MAP.get(label)
        if etype is None:
            continue

        out.append({
            "id": None,
            "type": etype.value if hasattr(etype, "value") else str(etype),
            "value": value,
            "confidence": 0.85 if label in _SPACY_LAYER_LABELS else 0.95,
            "extracted_from": source_name,
            "layer": "spacy" if label in _SPACY_LAYER_LABELS else "regex",
            "attributes": {
                "start": item.get("start"),
                "end": item.get("end"),
                "source_sentence": item.get("source_sentence", ""),
                "page": item.get("page", 1),
                **({"case_id": case_id} if case_id else {}),
            },
        })
    return out


def _llm_was_used(relations: list[dict[str, Any]]) -> bool:
    """Co-occurrence fallback evidence always starts with 'Co-mentioned'."""
    if not relations:
        return False
    return not all(
        str(r.get("evidence", "")).startswith("Co-mentioned") for r in relations
    )


def _dedupe(state: EntityAgentState) -> EntityAgentState:
    """Final node: dedupe + sort entities (stability for graph building)."""
    ents = state.get("entities", [])
    best: dict[tuple[str, str], dict[str, Any]] = {}
    for e in ents:
        key = (str(e.get("type", "")), str(e.get("value", "")).upper())
        if key not in best or e.get("confidence", 0) > best[key].get("confidence", 0):
            best[key] = e

    deduped = sorted(best.values(), key=lambda x: (str(x.get("type")), str(x.get("value"))))
    logger.info(
        f"[entity_agent] done: {len(deduped)} entities "
        f"({len(ents) - len(deduped)} duplicates removed), "
        f"{len(state.get('relations', []))} relations, "
        f"mode={state.get('pipeline_mode')}, llm_used={state.get('llm_used')}"
    )
    return {"entities": deduped}


def build_entity_agent():
    """Build the entity extraction sub-graph (reusable by the supervisor)."""
    g = StateGraph(EntityAgentState)

    g.add_node("full_pipeline", _run_full_pipeline)
    g.add_node("text_pipeline", _run_text_pipeline)
    g.add_node("dedupe", _dedupe)

    g.set_conditional_entry_point(
        _route,
        {"full": "full_pipeline", "text": "text_pipeline"},
    )
    g.add_edge("full_pipeline", "dedupe")
    g.add_edge("text_pipeline", "dedupe")
    g.add_edge("dedupe", END)

    return g.compile()
