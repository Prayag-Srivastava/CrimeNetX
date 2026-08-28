"""Multi-Case Cross-Reference Engine.

Ingests the case's extracted entities + FIR text into ChromaDB (fir_embeddings
collection), then semantically searches historical cases. Entities that appear
in multiple cases (shared phones, plates, accounts) are surfaced as strong
cross-case links with relevance scores.
"""
from __future__ import annotations

import logging
from typing import Any

from app.db.chroma_client import upsert_fir, search_firs
from app.models.schemas import CrossReferenceMatch, CrossReferenceResponse

logger = logging.getLogger("crimenetx.xref")


def index_case(case_id: str, case_number: str, fir_text: str, source_date: str = "") -> None:
    upsert_fir(case_id, case_number, fir_text, source_date)


def cross_reference(
    case_id: str,
    fir_text: str,
    entities: list[dict[str, Any]],
    historical_cases: list[dict[str, Any]] | None = None,
) -> CrossReferenceResponse:
    """Search similar FIRs semantically + overlay exact entity matches.

    historical_cases: optional [{"id", "case_number", "entities": [...]}]
    used to compute exact-match boosts without a Chroma dependency.
    """
    semantic = search_firs(fir_text[:8000], exclude_case_id=case_id, n_results=10)

    my_entity_keys = {f"{e.get('type')}:{str(e.get('value','')).upper()}" for e in entities}

    matches: list[CrossReferenceMatch] = []
    for r in semantic:
        matched = _entity_overlap(my_entity_keys, (r.get("metadata") or {}).get("entity_keys", []))
        score = round((1.0 - float(r.get("distance", 1.0))) * 100, 1)
        matches.append(
            CrossReferenceMatch(
                case_id=r["case_id"],
                case_number=(r.get("metadata") or {}).get("case_number", ""),
                score=score,
                matched_entities=matched[:5],
                matched_reason="Semantic FIR similarity" + (" + entity overlap" if matched else ""),
            )
        )

    # Exact-entity matches against provided historical corpus (offline mode)
    if historical_cases:
        for h in historical_cases:
            if h["id"] == case_id:
                continue
            overlap = _entity_overlap(my_entity_keys, {f"{e.get('type')}:{str(e.get('value','')).upper()}" for e in h.get("entities", [])})
            if overlap and not any(m.case_id == h["id"] for m in matches):
                matches.append(
                    CrossReferenceMatch(
                        case_id=h["id"],
                        case_number=h.get("case_number", ""),
                        score=85.0,
                        matched_entities=overlap[:5],
                        matched_reason="Exact entity match across cases",
                    )
                )

    matches.sort(key=lambda m: m.score, reverse=True)
    return CrossReferenceResponse(case_id=case_id, matches=matches[:10])


def _entity_overlap(a: set[str], b: set[str] | list[str]) -> list[str]:
    return sorted(a & set(b))
