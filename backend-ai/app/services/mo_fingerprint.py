"""Modus Operandi Fingerprinting — serial offender detection.

1. Groq extracts structured MO features from an FIR narrative:
   entry_method, tools_used, time_of_day, target_type, signature_traits.
2. Features are flattened into a semantic text fingerprint and embedded into
   ChromaDB (cosine space).
3. Cosine similarity search returns similar historical cases + match %.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from pydantic import BaseModel, Field

from app.config import settings
from app.db.chroma_client import MO_COLLECTION, upsert_mo_fingerprint, search_mo as _search_mo, get_chroma_client
from app.llm.groq_client import groq_structured
from app.models.schemas import MOFeatures, MOFingerprintResponse, SimilarCase

logger = logging.getLogger("crimenetx.mo")


class _MOOut(BaseModel):
    entry_method: str = ""
    tools_used: list[str] = Field(default_factory=list)
    time_of_day: str = ""
    target_type: str = ""
    signature_traits: list[str] = Field(default_factory=list)
    summary: str = ""


def extract_mo_features(fir_text: str) -> MOFeatures:
    """Extract MO features with Groq; fall back to deterministic extraction."""
    out = groq_structured(
        (
            "Analyze this Indian police FIR and extract the criminal Modus Operandi: "
            "entry_method (how the offender gained access), tools_used, time_of_day, "
            "target_type, signature_traits (distinctive hallmarks), summary.\n\n"
            f"FIR:\n{fir_text[:12000]}"
        ),
        _MOOut,
        temperature=0.1,
    )
    if out is not None:
        return MOFeatures(
            entry_method=out.entry_method,
            tools_used=out.tools_used,
            time_of_day=out.time_of_day,
            target_type=out.target_type,
            signature_traits=out.signature_traits,
            summary=out.summary,
        )
    return _rule_based_mo(fir_text)


def _rule_based_mo(text: str) -> MOFeatures:
    """Deterministic fallback when Groq is unavailable (demo mode)."""
    tools: list[str] = []
    for tool in ["crowbar", "gun", "pistol", "knife", "lock pick", "vehicle", "mask", "acid", "laptop", "mobile"]:
        if tool.lower() in text.lower():
            tools.append(tool.title())
    # crude time-of-day guess via common phrases
    time_of_day = "unknown"
    low = text.lower()
    if "night" in low or "10:" in text or "11:" in text:
        time_of_day = "night"
    elif "morning" in low or "06:" in text or "07:" in text or "08:" in text:
        time_of_day = "morning"
    elif "afternoon" in low or "12:" in text or "13:" in text or "14:" in text:
        time_of_day = "afternoon"
    elif "evening" in low or "17:" in text or "18:" in text or "19:" in text:
        time_of_day = "evening"
    return MOFeatures(
        entry_method="(rule-based: see narrative)",
        tools_used=tools,
        time_of_day=time_of_day,
        target_type="(rule-based)",
        signature_traits=["(unavailable without LLM)"],
        summary="Rule-based fallback (set GROQ_API_KEY for rich MO extraction).",
    )


def _fingerprint_text(features: MOFeatures) -> str:
    """Flatten MO features into a dense semantic fingerprint string."""
    return json.dumps(
        {
            "entry_method": features.entry_method,
            "tools_used": features.tools_used,
            "time_of_day": features.time_of_day,
            "target_type": features.target_type,
            "signature_traits": features.signature_traits,
        },
        ensure_ascii=False,
    )


def fingerprint_case(case_id: str, fir_text: str, case_number: str = "") -> MOFingerprintResponse:
    """Extract MO, embed, and return similar cases."""
    features = extract_mo_features(fir_text)
    fp_text = _fingerprint_text(features)

    upsert_mo_fingerprint(
        case_id,
        fp_text,
        {"case_id": case_id, "case_number": case_number, "summary": features.summary},
    )

    raw = _search_mo(fp_text, exclude_case_id=case_id, n_results=5)
    similar = [
        SimilarCase(
            case_id=r["case_id"],
            case_number=(r.get("metadata") or {}).get("case_number", ""),
            match_percentage=r["match_percentage"],
            matched_features=_matched_features(r["match_percentage"]),
        )
        for r in raw
    ]
    return MOFingerprintResponse(case_id=case_id, features=features, similar_cases=similar)


def _matched_features(pct: float) -> list[str]:
    # Approximate which feature groups matched based on similarity band.
    if pct >= 80:
        return ["entry_method", "tools_used", "time_of_day", "target_type", "signature_traits"]
    if pct >= 60:
        return ["entry_method", "tools_used", "time_of_day"]
    return ["entry_method"]


def similar_cases(case_id: str, query_text: str | None = None, n: int = 5) -> list[SimilarCase]:
    raw = _search_mo(query_text or case_id, exclude_case_id=case_id, n_results=n)
    return [
        SimilarCase(
            case_id=r["case_id"],
            case_number=(r.get("metadata") or {}).get("case_number", ""),
            match_percentage=r["match_percentage"],
            matched_features=["*"],
        )
        for r in raw
    ]
