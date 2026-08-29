"""Three-layer NLP entity extraction pipeline.

Layer 1 — spaCy NER      : PERSON, GPE, LOC, ORG, DATE (fast, deterministic)
Layer 2 — regex          : Indian phones, vehicle plates, bank accounts, PAN, IFSC, Crypto Wallets
Layer 3 — Groq LLM       : contextual aliases, nicknames, hidden relationships
                           (requires GROQ_API_KEY; graceful fallback without it)
Layer 4 — Gemini Vision  : Multilingual OCR + Translation for handwritten/scanned FIRs

Output is Pydantic-validated structured JSON (EntityExtractionResponse).
"""
from __future__ import annotations

import json
import logging
from typing import Any
import google.generativeai as genai
import spacy

from app.config import settings
from app.llm.groq_client import groq_structured
from app.models.schemas import Entity, EntityExtractionResponse, EntityType, RelationType
from app.utils import regex_extractors

# Configure Gemini Vision if key is available
if settings.gemini_api_key:
    genai.configure(api_key=settings.gemini_api_key)

logger = logging.getLogger("crimenetx.nlp")

_nlp: Any = None


def _get_spacy():
    global _nlp
    if _nlp is None:
        try:
            _nlp = spacy.load("en_core_web_sm")
        except OSError:
            logger.warning(
                "spaCy model en_core_web_sm not installed — run: "
                "python -m spacy download en_core_web_sm"
            )
            _nlp = False
    return _nlp


# spaCy label -> our EntityType
_LABEL_MAP = {
    "PERSON": EntityType.PERSON,
    "GPE": EntityType.LOCATION,
    "LOC": EntityType.LOCATION,
    "FAC": EntityType.LOCATION,
    "ORG": EntityType.ORGANIZATION,
    "DATE": EntityType.DATE,
    "TIME": EntityType.DATE,
}


def _spacy_layer(text: str, source: str) -> list[Entity]:
    nlp = _get_spacy()
    if not nlp:
        return []
    doc = nlp(text)
    entities: list[Entity] = []
    for ent in doc.ents:
        etype = _LABEL_MAP.get(ent.label_)
        if etype is None:
            continue
        entities.append(
            Entity(
                type=etype,
                value=ent.text.strip(),
                confidence=0.85 if etype in (EntityType.PERSON, EntityType.LOCATION) else 0.7,
                extracted_from=source,
                layer="spacy",
            )
        )
    return entities


def _regex_layer(text: str, source: str) -> list[Entity]:
    found = regex_extractors.extract_all(text)
    entities: list[Entity] = []
    
    for phone in found.get("phones", []):
        entities.append(Entity(type=EntityType.PHONE, value=phone, confidence=0.95, extracted_from=source, layer="regex"))
    for veh in found.get("vehicles", []):
        entities.append(Entity(type=EntityType.VEHICLE, value=veh, confidence=0.92, extracted_from=source, layer="regex"))
    for acct in found.get("bank_accounts", []):
        entities.append(Entity(type=EntityType.BANK_ACCOUNT, value=acct, confidence=0.9, extracted_from=source, layer="regex"))
    for ifsc in found.get("ifsc", []):
        entities.append(Entity(type=EntityType.BANK_ACCOUNT, value=f"IFSC:{ifsc}", confidence=0.9, extracted_from=source, layer="regex"))
    for wallet in found.get("crypto_wallets", []):
        entities.append(Entity(type=EntityType.CRYPTO_WALLET, value=wallet, confidence=0.95, extracted_from=source, layer="regex"))
        
    return entities


class _AliasSchema(EntityExtractionResponse):  # reuse for LLM structured output
    pass


def _llm_layer(text: str, source: str) -> tuple[list[Entity], list[dict[str, Any]]]:
    """Layer 3 — Groq extracts aliases/nicknames and inferred relationships."""
    from pydantic import BaseModel, Field

    class LlmAlias(BaseModel):
        value: str
        canonical_name: str = ""
        confidence: float = 0.6

    class LlmRelation(BaseModel):
        source: str
        target: str
        relation: str = "associate"
        evidence: str = ""

    class LlmOut(BaseModel):
        aliases: list[LlmAlias]
        relations: list[LlmRelation]

    prompt = (
    "You are analyzing an Indian police FIR for an investigation graph.\n\n"
    "Extract TWO things:\n\n"

    "1. ALIASES:\n"
    "Identify nicknames, aliases, street names, or aka references for "
    "persons.\n"
    "For each alias, return the alias exactly as written and the person's "
    "canonical full name when known.\n\n"

    "2. RELATIONS:\n"
    "Identify relationships explicitly stated or strongly supported by "
    "the FIR between entities.\n\n"

    "Allowed relation types:\n"
    "- family: family relationship\n"
    "- associate: persons or entities explicitly associated\n"
    "- same_organization: belongs to the same organization/group\n"
    "- phone_call: a person/entity communicated using a phone number\n"
    "- financial_transfer: money/account transaction relationship\n"
    "- co_location: entities connected by being at the same location\n\n"

    "IMPORTANT RULES FOR RELATIONS:\n"
    "- source and target MUST be copied exactly from entity names/values "
    "that appear in the FIR.\n"
    "- Do not invent entities.\n"
    "- Prefer explicit relationships over speculation.\n"
    "- If a person is explicitly associated with a phone number, vehicle, "
    "bank account, organization, or location, include that relationship.\n"
    "- If two persons are described as working together, meeting, "
    "communicating, or participating in the same incident, include an "
    "associate relationship.\n"
    "- Return multiple relations when multiple relationships are present.\n"
    "- Include the exact textual evidence supporting each relation.\n\n"

    f"FIR TEXT:\n{text[:12000]}\n\n"
    f"SOURCE: {source}"
)
    result = groq_structured(prompt, LlmOut, temperature=0.1)
    if result is None:
        return [], []

    entities = [
        Entity(
            type=EntityType.ALIAS,
            value=a.value,
            confidence=min(0.95, a.confidence + 0.1),
            extracted_from=source,
            layer="llm",
            attributes={"canonical_name": a.canonical_name},
        )
        for a in result.aliases
    ]
    relations = [
        {
            "source": r.source,
            "target": r.target,
            "relation": r.relation,
            "evidence": r.evidence or source,
        }
        for r in result.relations
    ]
    return entities, relations


def extract_entities(text: str, source_name: str = "manual", case_id: str | None = None) -> EntityExtractionResponse:
    """Run all layers, dedupe by (type, value), return validated response."""
    source = source_name or case_id or "manual"

    spacy_ents = _spacy_layer(text, source)
    regex_ents = _regex_layer(text, source)
    llm_ents, relations = _llm_layer(text, source)

    # Fallback to co-mention relations if LLM returned none
    if not relations:
        relations = _cooccurrence_relations(text, spacy_ents + llm_ents, source)

    all_ents: list[Entity] = spacy_ents + regex_ents + llm_ents

    # Dedupe: keep highest-confidence entity per (type, value) tuple
    best: dict[tuple[str, str], Entity] = {}
    for ent in all_ents:
        key = (ent.type.value, ent.value.upper())
        if key not in best or ent.confidence > best[key].confidence:
            best[key] = ent

    entities = sorted(best.values(), key=lambda e: (e.type.value, e.value))
    warnings: list[str] = []
    if not spacy_ents and not llm_ents and regex_ents:
        warnings.append("spaCy model unavailable or no NER hits; regex + LLM results shown.")
    if llm_ents == [] and len(text) > 200:
        warnings.append("Groq unavailable (GROQ_API_KEY not set) — alias/relation layer skipped.")

    return EntityExtractionResponse(entities=entities, relations=relations, llm_used=bool(llm_ents), warnings=warnings)


def _cooccurrence_relations(
    text: str,
    entities: list[Entity],
    source: str,
) -> list[dict[str, Any]]:
    """
    Deterministic fallback relation extraction.

    Creates relationships between entities that occur together in the same
    sentence. This is intentionally conservative: it does not claim a
    specific criminal relationship, only that the entities are associated
    within the same FIR context.

    The LLM remains responsible for stronger semantic relations such as
    family, financial_transfer, phone_call, etc.
    """
    import re

    # Remove duplicate entities by type + normalized value.
    unique: dict[tuple[str, str], Entity] = {}

    for entity in entities:
        value = entity.value.strip()
        if not value:
            continue

        key = (entity.type.value, value.upper())

        if key not in unique:
            unique[key] = entity

    usable_entities = list(unique.values())

    if len(usable_entities) < 2:
        return []

    relations: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    # Split FIR into sentences / reasonably small textual units.
    sentences = re.split(r"(?<=[.!?])\s+|\n+", text)

    for sentence in sentences:
        sentence = sentence.strip()

        if not sentence:
            continue

        mentioned: list[Entity] = []

        for entity in usable_entities:
            value = entity.value.strip()

            if len(value) < 2:
                continue

            if value.lower() in sentence.lower():
                mentioned.append(entity)

        # Need at least two entities in the same textual unit.
        if len(mentioned) < 2:
            continue

        # Create pairwise association links.
        for i, source_entity in enumerate(mentioned):
            for target_entity in mentioned[i + 1:]:
                source_value = source_entity.value.strip()
                target_value = target_entity.value.strip()

                if source_value.lower() == target_value.lower():
                    continue

                key = (
                    source_value.upper(),
                    target_value.upper(),
                    RelationType.ASSOCIATE.value,
                )

                # Treat the relationship as undirected for deduplication.
                reverse_key = (
                    target_value.upper(),
                    source_value.upper(),
                    RelationType.ASSOCIATE.value,
                )

                if key in seen or reverse_key in seen:
                    continue

                seen.add(key)

                relations.append(
                    {
                        "source": source_value,
                        "target": target_value,
                        "relation": RelationType.ASSOCIATE.value,
                        "evidence": (
                            f"Entities co-mentioned in FIR text "
                            f"({source})"
                        ),
                    }
                )

    return relations


def extract_from_cdr(rows: list[dict[str, Any]], case_id: str | None = None) -> EntityExtractionResponse:
    """Build entities + phone-call relations from CDR rows."""
    entities: list[Entity] = []
    relations: list[dict[str, Any]] = []
    phones = sorted({str(r["from_number"]) for r in rows} | {str(r["to_number"]) for r in rows})
    for phone in phones:
        entities.append(
            Entity(type=EntityType.PHONE, value=phone, confidence=0.99, extracted_from=f"CDR:{case_id or ''}", layer="regex")
        )
    for i, row in enumerate(rows[:2000]):
        relations.append(
            {
                "source": str(row["from_number"]),
                "target": str(row["to_number"]),
                "relation": RelationType.PHONE_CALL.value,
                "evidence": f"CDR row {i} @ {row.get('call_time')}",
            }
        )
    return EntityExtractionResponse(entities=entities, relations=relations, llm_used=False)


def extract_from_bank(txns: list[dict[str, Any]], case_id: str | None = None) -> EntityExtractionResponse:
    """Build account entities + financial-transfer relations from bank CSV rows."""
    entities: list[Entity] = []
    relations: list[dict[str, Any]] = []
    accounts = sorted({str(t["from_account"]) for t in txns} | {str(t["to_account"]) for t in txns})
    for acct in accounts:
        entities.append(
            Entity(type=EntityType.BANK_ACCOUNT, value=acct, confidence=0.99, extracted_from=f"BANK:{case_id or ''}", layer="regex")
        )
    for t in txns:
        relations.append(
            {
                "source": str(t["from_account"]),
                "target": str(t["to_account"]),
                "relation": RelationType.FINANCIAL_TRANSFER.value,
                "evidence": f"{t.get('amount')} INR @ {t.get('timestamp')}",
            }
        )
    return EntityExtractionResponse(entities=entities, relations=relations, llm_used=False)


async def extract_and_translate_handwritten_fir(image_bytes: bytes, mime_type: str = "image/jpeg") -> str:
    """
    Extracts text from handwritten or regional language FIR scanned photos
    and translates them directly to clean English using Gemini Vision.
    """
    if not settings.gemini_api_key:
        logger.error("GEMINI_API_KEY missing — cannot perform handwritten FIR OCR.")
        return "Error: GEMINI_API_KEY is not configured on the server."

    try:
        model = genai.GenerativeModel("gemini-1.5-flash")
        
        prompt = """
        You are an expert law enforcement OCR specialist in India.
        Analyze this scanned/handwritten First Information Report (FIR) image.
        1. Extract all text, regardless of handwriting quality or regional language (Hindi, Marathi, Gujarati, Tamil, etc.).
        2. Translate the entire text accurately into formal English.
        3. Return ONLY the final translated English text describing the FIR events, accused names, places, phone numbers, and stolen items.
        """
        
        # Correct Non-blocking Async call
        response = await model.generate_content_async([
            prompt,
            {"mime_type": mime_type, "data": image_bytes}
        ])
        
        return response.text or ""
    except Exception as e:
        logger.error(f"Gemini OCR Failed: {str(e)}")
        return f"OCR Processing Error: {str(e)}"