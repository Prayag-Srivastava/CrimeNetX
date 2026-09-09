"""
CrimeNetX — NLP Extractor
=========================

STAGE 3 / 5 of the forensic pipeline.

Entity + Relation Extraction:
    Primary:  GLiNER-relex (joint zero-shot NER + RE, one forward pass)
    Fallback: plain GLiNER (entities only) → spaCy → regex
    Relations fallback: co-occurrence; optional Groq if GROQ_RELATION_FALLBACK=True

Always:
    Regex for deterministic Indian PII (+ email)

Structured:
    CDR / Bank rule extractors
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from app.config import (
    GROQ_API_KEY,
    GLINER_MODEL,
    GLINER_THRESHOLD,
    USE_GLINER,
    SPACY_MODEL,
)
from app.models.schemas import Entity, EntityExtractionResponse, EntityType

logger = logging.getLogger(__name__)

# Optional relex settings (safe defaults if not yet in config)
try:
    from app.config import (
        GLINER_RELEX_MODEL,
        USE_GLINER_RELEX,
        RELEX_ENTITY_THRESHOLD,
        RELEX_ADJACENCY_THRESHOLD,
        RELEX_RELATION_THRESHOLD,
        GROQ_RELATION_FALLBACK,
    )
except ImportError:
    GLINER_RELEX_MODEL = "knowledgator/gliner-relex-large-v0.5"
    USE_GLINER_RELEX = True
    RELEX_ENTITY_THRESHOLD = 0.4
    RELEX_ADJACENCY_THRESHOLD = 0.55
    RELEX_RELATION_THRESHOLD = 0.75
    GROQ_RELATION_FALLBACK = False


# ============================================================
# LABELS — dict form = name + description (best for relex)
# ============================================================

CRIME_ENTITY_LABELS: dict[str, str] = {
    "person": "A human individual named in the FIR",
    "police officer": "Police personnel, IO, SHO, constable",
    "victim": "Person who suffered harm or loss",
    "witness": "Person who observed the incident",
    "suspect": "Person accused or suspected of the crime",
    "location": "Place, area, landmark, or geographic location",
    "city": "City or town name",
    "police station": "Police station or thana name",
    "address": "Street address or residential address",
    "organization": "Company, institution, agency, or group",
    "gang name": "Criminal gang or syndicate name",
    "phone number": "Mobile or landline telephone number",
    "vehicle registration number": "Vehicle number plate / registration",
    "bank account number": "Bank account, IFSC-linked account, or wallet id",
    "aadhaar number": "Indian Aadhaar identity number",
    "pan card number": "Indian PAN card number",
    "weapon": "Firearm, knife, or other weapon",
    "drug": "Narcotic or controlled substance",
    "stolen item": "Item reported stolen or looted",
    "date": "Calendar date of an event",
    "time": "Time of day of an event",
    "money amount": "Sum of money, cash, or transfer amount",
    "law section": "IPC, BNS, CrPC, IT Act section citation",
    "court name": "Name of a court",
    "case number": "FIR number, case number, or CR number",
    "email": "Email address",
    "other": "Entity involved in a relation but not matching other types",
}

# Plain list for legacy GLiNER.predict_entities
CRIME_ENTITY_LABEL_LIST = [k for k in CRIME_ENTITY_LABELS.keys() if k != "other"]

CRIME_RELATION_LABELS: list[str] = [
    "family",
    "associate",
    "same_organization",
    "phone_call",
    "financial_transfer",
    "co_location",
    "victim_of",
    "witness_to",
    "accused_of",
    "owns",
    "works_at",
    "member_of",
]

GLINER_LABEL_TO_DB = {
    "person": "PERSON",
    "police officer": "PERSON",
    "victim": "PERSON",
    "witness": "PERSON",
    "suspect": "PERSON",
    "location": "LOCATION",
    "city": "LOCATION",
    "police station": "LOCATION",
    "address": "LOCATION",
    "organization": "ORGANIZATION",
    "gang name": "ORGANIZATION",
    "phone number": "PHONE",
    "vehicle registration number": "VEHICLE",
    "bank account number": "BANK_ACCOUNT",
    "aadhaar number": "PERSON",
    "pan card number": "PERSON",
    "weapon": "WEAPON",
    "drug": "DRUG",
    "stolen item": "STOLEN_ITEM",
    "date": "DATE",
    "time": "DATE",
    "money amount": "MONEY",
    "law section": "ORGANIZATION",
    "court name": "ORGANIZATION",
    "case number": "ORGANIZATION",
    "email": "EMAIL",
    "other": "ORGANIZATION",
}

RELATION_TO_DB: dict[str, str] = {
    "family": "family",
    "associate": "associate",
    "same_organization": "same_organization",
    "phone_call": "phone_call",
    "financial_transfer": "financial_transfer",
    "co_location": "co_location",
    "victim_of": "associate",
    "witness_to": "associate",
    "accused_of": "associate",
    "owns": "associate",
    "works_at": "same_organization",
    "member_of": "same_organization",
    "called": "phone_call",
    "contacted": "phone_call",
    "relative of": "family",
    "son of": "family",
    "daughter of": "family",
    "wife of": "family",
    "husband of": "family",
    "met at": "co_location",
    "located in": "co_location",
    "transferred money to": "financial_transfer",
    "paid": "financial_transfer",
}

RELATION_TYPES = (
    "family",
    "associate",
    "same_organization",
    "phone_call",
    "financial_transfer",
    "co_location",
)


# ============================================================
# Script detection
# ------------------------------------------------------------
# The agent/frontend path can hand us raw Devanagari (the forensic pipeline
# translates in Stage 2, but the agent's text mode has no such stage), so we
# need to recognise it and translate before NER runs.
# ============================================================

_INDIC_SCRIPTS = {
    "DEVANAGARI", "BENGALI", "GUJARATI", "GURMUKHI", "KANNADA",
    "MALAYALAM", "ORIYA", "ODIA", "TAMIL", "TELUGU", "ARABIC",
    "OL", "MEETEI", "THAANA", "SINHALA",
}


def _script_of(ch: str) -> str:
    try:
        name = unicodedata.name(ch, "")
    except ValueError:
        return "UNKNOWN"
    return name.split()[0] if name else "UNKNOWN"


def indic_ratio(text: str) -> float:
    """Fraction of alphabetic characters that are non-Latin Indic script."""
    if not text:
        return 0.0
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if _script_of(c) in _INDIC_SCRIPTS) / len(letters)


def contains_indic(text: str) -> bool:
    """True if any character belongs to an Indic script."""
    return any(_script_of(c) in _INDIC_SCRIPTS for c in (text or "") if c.isalpha())


def is_probably_english(text: str, threshold: float = 0.10) -> bool:
    """True if the text is dominantly Latin script."""
    return indic_ratio(text) < threshold


# ============================================================
# Label mapping for the agent path
# ------------------------------------------------------------
# extract_entities_with_spans() emits DB-shaped labels (PERSON, PHONE, ...)
# from GLiNER and raw spaCy labels (PER, GPE, ORG, ...) from the spaCy
# fallback. Both are mapped onto the EntityType enum here. Labels with no
# EntityType equivalent (WEAPON, DRUG, MONEY, EMAIL, STOLEN_ITEM) map to
# nothing and are dropped by the caller - the app's schema has no column
# for them.
# ============================================================

_LABEL_MAP: dict[str, EntityType] = {
    # GLiNER / regex DB labels
    "PERSON": EntityType.PERSON,
    "LOCATION": EntityType.LOCATION,
    "ORGANIZATION": EntityType.ORGANIZATION,
    "PHONE": EntityType.PHONE,
    "VEHICLE": EntityType.VEHICLE,
    "BANK_ACCOUNT": EntityType.BANK_ACCOUNT,
    "CRYPTO_WALLET": EntityType.CRYPTO_WALLET,
    "DATE": EntityType.DATE,
    "ALIAS": EntityType.ALIAS,
    # raw spaCy labels (spaCy fallback path)
    "PER": EntityType.PERSON,
    "GPE": EntityType.LOCATION,
    "LOC": EntityType.LOCATION,
    "FAC": EntityType.LOCATION,
    "ORG": EntityType.ORGANIZATION,
}

# Labels that come from a statistical model rather than a deterministic
# regex - scored slightly lower, and tagged as the "spacy" layer.
_SPACY_LAYER_LABELS = {
    "PERSON", "PER", "GPE", "LOC", "LOCATION", "FAC",
    "ORG", "ORGANIZATION", "DATE",
}


# ============================================================
# Person-name validation
# ------------------------------------------------------------
# Every FIR names a police station, a duty officer and their rank, and uses
# role words ("accused", "complainant") as if they were names. NER labels all
# of it PERSON. Left unfiltered they become nodes on the criminal network and
# distort centrality, so clean the honorifics/ranks off a name and reject
# anything that is not plausibly a person.
# ============================================================

_TITLE_PREFIXES = (
    "shri", "shree", "smt", "sri", "mr", "mrs", "ms", "dr", "shri.",
    "accused", "complainant", "witness", "informant", "the", "one",
    "si", "psi", "asi", "pi", "acp", "dcp", "sp", "dsp", "constable",
)

_PERSON_STOPWORDS = {
    "police", "station", "court", "fir", "ipc", "bns", "crpc", "bnss",
    "section", "act", "state", "india", "government", "district",
    "complaint", "accused", "unknown", "sir", "madam", "officer",
}

# Tokens that never occur inside a real person's name. One occurrence
# anywhere disqualifies the whole string - "Hinjewadi Police Station" holds a
# genuine place name but is a building, and "Assistant Sub-Inspector" is a
# rank. Checking every token (rather than requiring all of them to match)
# is what separates this from the original all-token rule.
_PERSON_HARD_STOPWORDS = {
    # places of record
    "police", "station", "thana", "chowky", "court", "department",
    # document / statute furniture
    "fir", "gd", "ipc", "bns", "crpc", "bnss", "section", "act",
    "report", "information", "complaint", "government", "cctv",
    # ranks and roles
    "inspector", "constable", "havaldar", "superintendent",
    "commissioner", "officer", "assistant", "asst", "sub",
}


def _name_tokens(name: str) -> list[str]:
    """Lowercase alphabetic tokens, splitting on punctuation so that
    'Sub-Inspector' and '(FIR)' are seen as their constituent words."""
    return [t for t in re.split(r"[^A-Za-z]+", name or "") if t]


# ============================================================
# Groq model fallback
# ------------------------------------------------------------
# Groq deprecates and rotates model IDs regularly. A single hardcoded name
# means one deprecation silently disables relation extraction, so try a chain
# and remember whichever answers.
# ============================================================

_GROQ_MODEL_CHAIN = [
    "openai/gpt-oss-120b",    # recommended, JSON mode
    "openai/gpt-oss-20b",     # faster / cheaper fallback
    "qwen/qwen3.6-27b",       # alternate
    "groq/compound-mini",     # last resort
]

# First model that answered; avoids re-probing the chain on every call.
_WORKING_GROQ_MODEL: Optional[str] = None


def _groq_model_candidates() -> list[str]:
    """Chain to try, honouring an explicitly pinned GROQ_MODEL first."""
    import os

    pinned = (os.getenv("GROQ_MODEL", "") or "").strip()
    if pinned:
        return [pinned] + [m for m in _GROQ_MODEL_CHAIN if m != pinned]
    return list(_GROQ_MODEL_CHAIN)


def _clean_person_name(raw: str) -> str:
    """Strip honorifics and role/rank words, normalise whitespace."""
    txt = re.sub(r"\s+", " ", raw or "").strip(" .,:;-\"'()")
    if not txt:
        return ""
    tokens = txt.split()
    while tokens and tokens[0].lower().strip(".") in _TITLE_PREFIXES:
        tokens.pop(0)
    return " ".join(tokens).strip(" .,:;-")


def _is_valid_person(name: str) -> bool:
    """Reject role words, station/court names, ranks with numbers, and
    descriptive phrases like 'three masked persons on two motorcycles'."""
    if not name or len(name) < 3 or len(name) > 60:
        return False
    if contains_indic(name):              # untranslated text leaked through
        return False
    if any(ch.isdigit() for ch in name):  # "SI 2908" is a badge, not a name
        return False
    if name.lower() in _PERSON_STOPWORDS:
        return False
    # one administrative token anywhere is enough to disqualify
    if any(t.lower() in _PERSON_HARD_STOPWORDS for t in _name_tokens(name)):
        return False
    tokens = [t for t in name.split() if t]
    if not tokens or len(tokens) > 5:
        return False
    if all(t.lower() in _PERSON_STOPWORDS for t in tokens):
        return False
    # a real name has at least one capitalised alphabetic token
    return any(t[0].isupper() and t.isalpha() for t in tokens)


class LlmRelation(BaseModel):
    source: str = Field(min_length=1)
    target: str = Field(min_length=1)
    relation: Literal[
        "family",
        "associate",
        "same_organization",
        "phone_call",
        "financial_transfer",
        "co_location",
    ]


class LlmExtraction(BaseModel):
    relations: list[LlmRelation] = Field(default_factory=list)


class NLPExtractor:
    """
    Primary: GLiNER-relex joint NER + RE
    Fallback: GLiNER entities → spaCy → regex
    Relations fallback: co-occurrence; optional Groq
    """

    def __init__(self):
        self._relex_model = None
        self._gliner_model = None
        self._spacy_nlp = None
        self._detector = None
        self._translator = None
        self._extraction_engine = "none"

        self._phone_pattern = re.compile(
            r"(?:(?:\+91|0)?[\s\-]?)?(?:\d{5}[\s\-]?\d{5}|\d{10})"
        )
        self._imei_pattern = re.compile(r"\b\d{15}\b")
        self._vehicle_pattern = re.compile(
            r"\b[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{1,4}\b",
            re.IGNORECASE,
        )
        self._law_pattern = re.compile(
            r"(?:BNS|IPC|CrPC|BNSS|IT Act|NDPS|POCSO)"
            r"\s*(?:§|Section|Sec\.?)\s*\d+[A-Z]?",
            re.IGNORECASE,
        )
        self._pincode_pattern = re.compile(r"\b[1-9]\d{5}\b")
        self._aadhaar_pattern = re.compile(r"\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b")
        self._ifsc_pattern = re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")
        self._pan_pattern = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")
        self._upi_pattern = re.compile(
            r"\b[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}\b"
        )
        # Your email enhancement
        self._email_pattern = re.compile(
            r"\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b"
        )

        self._load_engines()

    # ========================================================
    # ENGINE LOADING
    # ========================================================

    def _load_engines(self) -> None:
        # 1) GLiNER-relex
        if USE_GLINER_RELEX:
            try:
                from gliner import GLiNER

                logger.info(f"Loading GLiNER-relex: {GLINER_RELEX_MODEL}")
                self._relex_model = GLiNER.from_pretrained(GLINER_RELEX_MODEL)
                self._extraction_engine = "gliner-relex"
                logger.info("✅ GLiNER-relex ready (joint NER + relation extraction)")
                return
            except Exception as e:
                logger.warning(f"GLiNER-relex load failed: {e}")

        # 2) Plain GLiNER
        if USE_GLINER:
            try:
                from gliner import GLiNER

                logger.info(f"Loading GLiNER: {GLINER_MODEL}")
                self._gliner_model = GLiNER.from_pretrained(GLINER_MODEL)
                self._extraction_engine = "gliner"
                logger.info("GLiNER loaded (entities only)")
                return
            except Exception as e:
                logger.warning(f"GLiNER load failed: {e}")

        # 3) spaCy
        try:
            import spacy

            try:
                self._spacy_nlp = spacy.load(SPACY_MODEL)
            except OSError:
                self._spacy_nlp = spacy.load("en_core_web_sm")
            self._extraction_engine = "spacy"
            logger.info(f"spaCy loaded: {SPACY_MODEL}")
        except Exception as e:
            logger.error(f"No ML NER backend: {e}")
            self._extraction_engine = "regex_only"

    # ========================================================
    # PUBLIC: entities
    # ========================================================

    def ensure_english(self, text: str) -> str:
        """
        Guarantee the extractor receives Latin-script text.

        No-op for the ForensicPipeline, whose Stage 2 has already translated.
        The agent / frontend text path has no such stage, so raw Devanagari can
        arrive here - translate it inline rather than feeding it to a model
        that was never trained on it. Falls back to the original text if
        translation is unavailable, since degraded extraction beats none.
        """
        if not text or not text.strip():
            return text or ""
        if is_probably_english(text):
            return text

        try:
            detection = self._get_detector().detect(text)
            logger.warning(
                "ensure_english(): non-Latin text reached NER "
                f"(indic_ratio={indic_ratio(text):.2f}, lang={detection.language}). "
                "Translating inline; the caller should ideally translate upstream."
            )
            result = self._get_translator().translate(
                text,
                source_lang=detection.language,
                source_indictrans_code=detection.indictrans_code,
            )
            return result.translated_text if result.success else text
        except Exception as exc:
            logger.warning(f"ensure_english(): translation unavailable ({exc})")
            return text

    def _get_detector(self):
        """Cached - langdetect setup is not free and this runs per document."""
        if getattr(self, "_detector", None) is None:
            from app.services.language_detector import LanguageDetector
            self._detector = LanguageDetector()
        return self._detector

    def _get_translator(self):
        """Cached - IndicTrans2 loads a model, so never construct per call."""
        if getattr(self, "_translator", None) is None:
            from app.services.translator import TranslatorService
            self._translator = TranslatorService()
        return self._translator

    def extract_entities_with_spans(
        self, text: str, already_english: bool = False
    ) -> list[dict]:
        if not text or len(text.strip()) < 5:
            return []
        if not already_english:
            text = self.ensure_english(text)

        entities: list[dict] = []

        if self._extraction_engine == "gliner-relex" and self._relex_model:
            ents, _ = self._relex_joint(text, want_relations=False)
            entities.extend(ents)
        elif self._extraction_engine == "gliner" and self._gliner_model:
            entities.extend(self._extract_with_gliner(text))
        elif self._extraction_engine == "spacy" and self._spacy_nlp:
            entities.extend(self._extract_with_spacy(text))

        entities.extend(self._extract_with_regex(text))
        entities = self._deduplicate_entities(entities)

        logger.info(
            f"NER: {len(entities)} entities via {self._extraction_engine} "
            f"({sum(1 for e in entities if e['label'] == 'PERSON')} persons)"
        )
        return entities

    @staticmethod
    def _clean_person_entities(entities: list[dict]) -> list[dict]:
        """Clean and validate PERSON entities; other labels pass through.

        Runs after every engine so GLiNER, plain GLiNER and the spaCy fallback
        all get the same treatment. Dropped names are logged at debug level so
        the filter can be audited rather than silently swallowing evidence.
        """
        kept: list[dict] = []
        dropped: list[str] = []

        for ent in entities:
            if str(ent.get("label", "")).upper() != "PERSON":
                kept.append(ent)
                continue

            original = str(ent.get("text", ""))
            cleaned = _clean_person_name(original)
            if not _is_valid_person(cleaned):
                dropped.append(original)
                continue

            if cleaned != original:
                ent = {**ent, "text": cleaned, "original_text": original}
            kept.append(ent)

        if dropped:
            logger.debug(f"person filter dropped {len(dropped)}: {dropped[:8]}")
        return kept

    # ========================================================
    # PUBLIC: relations
    # ========================================================

    def extract_relationships(
        self,
        text: str,
        known_entities: Optional[list[str]] = None,
    ) -> list[dict]:
        if not text or len(text.strip()) < 20:
            return []

        relations: list[dict] = []

        if self._extraction_engine == "gliner-relex" and self._relex_model:
            _, relations = self._relex_joint(text, want_relations=True)
            if relations:
                relations = self._align_to_known(relations, known_entities)
                logger.info(f"GLiNER-relex extracted {len(relations)} relations")
                return relations

        if GROQ_RELATION_FALLBACK and GROQ_API_KEY:
            try:
                relations = self._llm_layer(text, known_entities)
                if relations:
                    return self._align_to_known(relations, known_entities)
            except Exception as e:
                logger.warning(f"Groq relationship extraction failed: {e}")

        return self._align_to_known(
            self._cooccurrence_relations(text), known_entities
        )

    @staticmethod
    def _align_to_known(
        relations: list[dict], known: Optional[list[str]]
    ) -> list[dict]:
        """Snap relation endpoints onto the canonical entity list.

        Extraction returns whatever surface form appeared in the text, so the
        same real thing arrives as several strings - "Rs. 153000" and
        "Rs. 153000/-", or a full name and a partial one. Left alone each
        variant becomes its own graph node and the same fact is drawn twice.
        Snapping to the known-entity list collapses them onto one node.
        """
        if not known:
            return relations

        lookup = {k.strip().lower(): k for k in known if k}

        def snap(name: str) -> str:
            n = (name or "").strip()
            low = n.lower()
            if low in lookup:
                return lookup[low]
            # substring match either way, longest candidate wins so that
            # "Ravi" prefers "Ravi Kumar Jadhav" over a shorter partial
            best = ""
            for k_low, k_orig in lookup.items():
                if low and (low in k_low or k_low in low):
                    if len(k_orig) > len(best):
                        best = k_orig
            return best or n

        out: list[dict] = []
        seen: set[tuple[str, str, str]] = set()
        for r in relations:
            src, tgt = snap(r.get("source", "")), snap(r.get("target", ""))
            if not src or not tgt or src == tgt:
                continue
            key = (src.lower(), str(r.get("relation", "")).lower(), tgt.lower())
            if key in seen:          # alignment can collapse variants into duplicates
                continue
            seen.add(key)
            out.append({**r, "source": src, "target": tgt})
        return out

    # ========================================================
    # PUBLIC: joint one-shot (preferred by pipeline)
    # ========================================================

    def extract_entities_and_relations(
        self, text: str
    ) -> tuple[list[dict], list[dict]]:
        if not text or len(text.strip()) < 5:
            return [], []

        if self._extraction_engine == "gliner-relex" and self._relex_model:
            ents, rels = self._relex_joint(text, want_relations=True)
            ents = self._deduplicate_entities(ents + self._extract_with_regex(text))
            if not rels:
                if GROQ_RELATION_FALLBACK and GROQ_API_KEY:
                    try:
                        rels = self._llm_layer(
                            text,
                            [e["text"] for e in ents if e["label"] == "PERSON"],
                        )
                    except Exception:
                        rels = []
                if not rels:
                    rels = self._cooccurrence_relations(text)
            # Align endpoints onto the entities we actually kept, so relations
            # reference real graph nodes rather than surface variants.
            rels = self._align_to_known(rels, [e["text"] for e in ents])
            return ents, rels

        ents = self.extract_entities_with_spans(text)
        rels = self.extract_relationships(
            text, [e["text"] for e in ents if e["label"] == "PERSON"]
        )
        return ents, rels

    # ========================================================
    # GLiNER-relex joint core
    # ========================================================

    def _relex_joint(
        self, text: str, want_relations: bool = True
    ) -> tuple[list[dict], list[dict]]:
        assert self._relex_model is not None

        all_entities: list[dict] = []
        all_relations: list[dict] = []

        for chunk, offset in self._chunk_text(text, max_chars=900):
            raw_ents, raw_rels = self._call_relex_inference(chunk, want_relations)

            for ent in raw_ents:
                label_raw = str(ent.get("label") or ent.get("type") or "other").lower().strip()
                db_label = GLINER_LABEL_TO_DB.get(label_raw, "ORGANIZATION")
                ent_text = str(ent.get("text", "")).strip()
                if not ent_text:
                    continue
                start = int(ent.get("start", 0))
                end = int(ent.get("end", start + len(ent_text)))
                source_sentence = self._find_source_sentence(chunk, start, end)
                all_entities.append(
                    {
                        "text": ent_text,
                        "label": db_label,
                        "gliner_label": label_raw,
                        "start": offset + start,
                        "end": offset + end,
                        "confidence": round(float(ent.get("score", 0.5)), 3),
                        "source_sentence": source_sentence[:200],
                        "page": 1,
                        "engine": "gliner-relex",
                    }
                )

            for rel in raw_rels:
                head = rel.get("head") or {}
                tail = rel.get("tail") or {}
                source = str(head.get("text", "")).strip()
                target = str(tail.get("text", "")).strip()
                if not source or not target or source.lower() == target.lower():
                    continue
                rname = str(rel.get("relation", "associate")).strip().lower()
                db_rel = RELATION_TO_DB.get(rname, "associate")
                if db_rel not in RELATION_TYPES:
                    db_rel = "associate"
                score = float(rel.get("score", 0.5))
                # Prefer FIR-grounded evidence (your design)
                evidence = self._find_relationship_evidence(text, source, target)
                if not evidence or evidence.startswith("Relationship extracted"):
                    evidence = (
                        f"GLiNER-relex [{rname}] score={score:.2f}. "
                        f"Context: {chunk[:280]}"
                    )
                all_relations.append(
                    {
                        "source": source,
                        "target": target,
                        "relation": db_rel,
                        "evidence": evidence[:500],
                        "weight": max(score, 0.1),
                        "engine": "gliner-relex",
                    }
                )

        return all_entities, all_relations

    def _call_relex_inference(
        self, chunk: str, want_relations: bool
    ) -> tuple[list[dict], list[dict]]:
        """Call model.inference with API-shape fallbacks."""
        labels: Any = CRIME_ENTITY_LABELS
        relations = CRIME_RELATION_LABELS if want_relations else []

        try:
            out = self._relex_model.inference(
                texts=[chunk],
                labels=labels,
                relations=relations,
                threshold=RELEX_ENTITY_THRESHOLD,
                adjacency_threshold=RELEX_ADJACENCY_THRESHOLD,
                relation_threshold=RELEX_RELATION_THRESHOLD,
                return_relations=want_relations,
                flat_ner=False,
            )
        except TypeError:
            try:
                out = self._relex_model.inference(
                    texts=[chunk],
                    labels=list(CRIME_ENTITY_LABELS.keys()),
                    relations=relations,
                    threshold=RELEX_ENTITY_THRESHOLD,
                    return_relations=want_relations,
                    flat_ner=False,
                )
            except Exception as e:
                logger.warning(f"relex inference failed: {e}")
                return [], []
        except Exception as e:
            logger.warning(f"relex inference failed: {e}")
            return [], []

        if want_relations and isinstance(out, tuple) and len(out) >= 2:
            ents_batch, rels_batch = out[0], out[1]
            chunk_ents = ents_batch[0] if ents_batch else []
            chunk_rels = rels_batch[0] if rels_batch else []
            return chunk_ents or [], chunk_rels or []

        # entities only
        if isinstance(out, tuple):
            ents_batch = out[0]
        else:
            ents_batch = out
        chunk_ents = ents_batch[0] if ents_batch else []
        return chunk_ents or [], []

    # ========================================================
    # Plain GLiNER (entity-only fallback)
    # ========================================================

    def _extract_with_gliner(self, text: str) -> list[dict]:
        try:
            all_entities = []
            for chunk, offset in self._chunk_text(text, max_chars=900):
                try:
                    raw = self._gliner_model.predict_entities(
                        chunk,
                        CRIME_ENTITY_LABEL_LIST,
                        threshold=GLINER_THRESHOLD,
                    )
                except Exception as e:
                    logger.warning(f"GLiNER chunk failed: {e}")
                    continue

                for ent in raw:
                    gliner_label = str(ent.get("label", "")).lower().strip()
                    db_label = GLINER_LABEL_TO_DB.get(gliner_label, "ORGANIZATION")
                    ent_start = int(ent.get("start", 0))
                    ent_end = int(ent.get("end", 0))
                    entity_text = str(ent.get("text", "")).strip()
                    if not entity_text:
                        continue
                    all_entities.append(
                        {
                            "text": entity_text,
                            "label": db_label,
                            "gliner_label": gliner_label,
                            "start": offset + ent_start,
                            "end": offset + ent_end,
                            "confidence": round(float(ent.get("score", 0.0)), 3),
                            "source_sentence": self._find_source_sentence(
                                chunk, ent_start, ent_end
                            )[:200],
                            "page": 1,
                            "engine": "gliner",
                        }
                    )
            return all_entities
        except Exception as e:
            logger.error(f"GLiNER extraction failed: {e}")
            return []

    # ========================================================
    # spaCy
    # ========================================================

    def _extract_with_spacy(self, text: str) -> list[dict]:
        entities = []
        try:
            doc = self._spacy_nlp(text)
            spacy_map = {
                "PERSON": "PERSON",
                "ORG": "ORGANIZATION",
                "GPE": "LOCATION",
                "LOC": "LOCATION",
                "DATE": "DATE",
                "MONEY": "MONEY",
                "TIME": "DATE",
                "LAW": "ORGANIZATION",
                "FAC": "LOCATION",
            }
            for ent in doc.ents:
                if ent.label_ not in spacy_map:
                    continue
                sentence = next(
                    (
                        sent.text.strip()
                        for sent in doc.sents
                        if sent.start_char <= ent.start_char
                        and sent.end_char >= ent.end_char
                    ),
                    "",
                )
                entities.append(
                    {
                        "text": ent.text.strip(),
                        "label": spacy_map[ent.label_],
                        "gliner_label": ent.label_.lower(),
                        "start": ent.start_char,
                        "end": ent.end_char,
                        "confidence": 0.85,
                        "source_sentence": sentence[:200],
                        "page": 1,
                        "engine": "spacy",
                    }
                )
        except Exception as e:
            logger.error(f"spaCy extraction failed: {e}")
        return entities

    # ========================================================
    # Regex (incl. email)
    # ========================================================

    def _extract_with_regex(self, text: str) -> list[dict]:
        regex_entities = []
        patterns = [
            ("PHONE", self._phone_pattern, "phone number"),
            ("PHONE", self._imei_pattern, "imei"),
            ("VEHICLE", self._vehicle_pattern, "vehicle registration"),
            ("ORGANIZATION", self._law_pattern, "law section"),
            ("LOCATION", self._pincode_pattern, "pincode"),
            ("PERSON", self._aadhaar_pattern, "aadhaar number"),
            ("BANK_ACCOUNT", self._ifsc_pattern, "ifsc code"),
            ("PERSON", self._pan_pattern, "pan card"),
            ("BANK_ACCOUNT", self._upi_pattern, "upi id"),
            ("EMAIL", self._email_pattern, "email"),
        ]
        for db_label, pattern, gliner_label in patterns:
            for match in pattern.finditer(text):
                matched_text = match.group().strip()
                if len(matched_text) < 4:
                    continue
                # Avoid double-counting plain emails as UPI when domain has a dot
                if gliner_label == "upi id" and "." in matched_text.split("@")[-1]:
                    # likely email already captured by email pattern
                    if self._email_pattern.fullmatch(matched_text):
                        continue
                regex_entities.append(
                    {
                        "text": matched_text,
                        "label": db_label,
                        "gliner_label": gliner_label,
                        "start": match.start(),
                        "end": match.end(),
                        "confidence": 1.0,
                        "source_sentence": self._find_source_sentence(
                            text, match.start(), match.end()
                        )[:200],
                        "page": 1,
                        "engine": "regex",
                    }
                )
        return regex_entities

    # ========================================================
    # Chunking (your enhanced version, kept)
    # ========================================================

    @staticmethod
    def _chunk_text(text: str, max_chars: int = 900) -> list[tuple[str, int]]:
        if not text or not text.strip():
            return []

        sentences = re.split(r"(?<=[.!?।])\s+|\n+", text.strip())
        sentences = [s.strip() for s in sentences if s.strip()]

        chunks: list[tuple[str, int]] = []
        current_parts: list[str] = []
        current_length = 0
        current_start = None
        search_position = 0

        for sentence in sentences:
            sentence_start = text.find(sentence, search_position)
            if sentence_start == -1:
                sentence_start = search_position
            sentence_end = sentence_start + len(sentence)
            search_position = sentence_end

            additional_length = len(sentence) + (1 if current_parts else 0)
            if current_parts and current_length + additional_length <= max_chars:
                current_parts.append(sentence)
                current_length += additional_length
                continue

            if current_parts:
                chunks.append(
                    (
                        " ".join(current_parts),
                        current_start if current_start is not None else 0,
                    )
                )
                current_parts = []
                current_length = 0
                current_start = None

            if len(sentence) <= max_chars:
                current_parts = [sentence]
                current_length = len(sentence)
                current_start = sentence_start
                continue

            words = sentence.split()
            piece_words: list[str] = []
            piece_length = 0
            piece_start = sentence_start
            cursor = sentence_start

            for word in words:
                word_position = text.find(word, cursor)
                if word_position == -1:
                    word_position = cursor
                cursor = word_position + len(word)
                additional = len(word) + (1 if piece_words else 0)
                if piece_words and piece_length + additional > max_chars:
                    chunks.append((" ".join(piece_words), piece_start))
                    piece_words = []
                    piece_length = 0
                    piece_start = word_position
                piece_words.append(word)
                piece_length += len(word) + (1 if len(piece_words) > 1 else 0)

            if piece_words:
                chunks.append((" ".join(piece_words), piece_start))

        if current_parts:
            chunks.append(
                (
                    " ".join(current_parts),
                    current_start if current_start is not None else 0,
                )
            )
        return chunks

    @staticmethod
    def _find_source_sentence(text: str, start: int, end: int) -> str:
        if not text:
            return ""
        start = max(0, min(start, len(text)))
        end = max(start, min(end, len(text)))
        left_boundary = max(
            text.rfind(".", 0, start),
            text.rfind("!", 0, start),
            text.rfind("?", 0, start),
            text.rfind("।", 0, start),
            text.rfind("\n", 0, start),
        )
        right_candidates = [
            p
            for p in (
                text.find(".", end),
                text.find("!", end),
                text.find("?", end),
                text.find("।", end),
                text.find("\n", end),
            )
            if p != -1
        ]
        right_boundary = min(right_candidates) if right_candidates else len(text)
        sentence = text[left_boundary + 1 : right_boundary + 1].strip()
        if sentence:
            return sentence
        left = max(0, start - 150)
        right = min(len(text), end + 150)
        return text[left:right].strip()

    @staticmethod
    def _deduplicate_entities(entities: list[dict]) -> list[dict]:
        if not entities:
            return []
        # Both extraction paths (with_spans and entities_and_relations) funnel
        # through here, so this is the one place person filtering is guaranteed
        # to run regardless of which engine produced the entities.
        entities = NLPExtractor._clean_person_entities(entities)
        entities.sort(
            key=lambda e: (
                e["start"],
                -e.get("confidence", 0),
                -(e["end"] - e["start"]),
            )
        )
        deduped = []
        for ent in entities:
            if not deduped:
                deduped.append(ent)
                continue
            previous = deduped[-1]
            if ent["start"] >= previous["end"]:
                deduped.append(ent)
                continue
            cur_c = ent.get("confidence", 0)
            prev_c = previous.get("confidence", 0)
            cur_l = ent["end"] - ent["start"]
            prev_l = previous["end"] - previous["start"]
            if cur_c > prev_c or (cur_c == prev_c and cur_l > prev_l):
                deduped[-1] = ent
        return deduped

    # ========================================================
    # Optional Groq (fallback only)
    # ========================================================

    def _llm_layer(
        self,
        text: str,
        known_entities: Optional[list[str]] = None,
    ) -> list[dict]:
        if not GROQ_API_KEY:
            return []

        try:
            from groq import Groq

            client = Groq(api_key=GROQ_API_KEY)
            entity_hint = ""
            if known_entities:
                cleaned = [str(e).strip() for e in known_entities[:20] if str(e).strip()]
                if cleaned:
                    entity_hint = "\nKnown entities:\n" + "\n".join(f"- {e}" for e in cleaned)

            fir_text = text[:4000]
            prompt = f"""Extract relationships from this FIR.
Allowed relations ONLY: family, associate, same_organization, phone_call, financial_transfer, co_location
Rules: only FIR-supported links; no invention; JSON only; if none: {{"relations":[]}}
{entity_hint}

FIR:
{fir_text}

{{"relations":[{{"source":"","target":"","relation":"associate"}}]}}"""

            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {
                        "role": "system",
                        "content": "Crime intelligence analyst. Return ONLY valid JSON.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0,
                max_tokens=700,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content
            if not content:
                return []
            parsed = json.loads(content)
            extraction = LlmExtraction.model_validate(parsed)
            relations = []
            for relation in extraction.relations:
                source = relation.source.strip()
                target = relation.target.strip()
                if not source or not target or source.lower() == target.lower():
                    continue
                evidence = self._find_relationship_evidence(text, source, target)
                relations.append(
                    {
                        "source": source,
                        "target": target,
                        "relation": relation.relation,
                        "evidence": evidence,
                        "engine": "groq",
                    }
                )
            return relations
        except Exception as e:
            logger.error(f"LLM layer error: {e}")
            return []

    @staticmethod
    def _find_relationship_evidence(text: str, source: str, target: str) -> str:
        if not text:
            return ""
        sentences = re.split(r"(?<=[.!?।])\s+|\n+", text)
        source_lower = source.lower()
        target_lower = target.lower()
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            sl = sentence.lower()
            if source_lower in sl and target_lower in sl:
                return sentence[:500]
        sp = text.lower().find(source_lower)
        tp = text.lower().find(target_lower)
        if sp != -1 and tp != -1:
            left = max(0, min(sp, tp) - 150)
            right = min(len(text), max(sp + len(source), tp + len(target)) + 250)
            return text[left:right].strip()[:500]
        return f"Relationship extracted between {source} and {target}."

    # ========================================================
    # Co-occurrence fallback
    # ========================================================

    def _cooccurrence_relations(self, text: str) -> list[dict]:
        # Prefer already-extracted persons via full entity pass
        try:
            ents = self.extract_entities_with_spans(text)
            persons = list(
                dict.fromkeys(
                    e["text"].strip()
                    for e in ents
                    if e.get("label") == "PERSON" and e.get("text", "").strip()
                )
            )
        except Exception:
            persons = []

        if len(persons) < 2:
            return []

        relations = []
        seen = set()
        # paragraph-ish pairing: if both appear in same window
        for i, a in enumerate(persons):
            for b in persons[i + 1 :]:
                pair = tuple(sorted([a, b]))
                if pair in seen:
                    continue
                # only if both appear within 400 chars somewhere
                la, lb = text.lower().find(a.lower()), text.lower().find(b.lower())
                if la == -1 or lb == -1:
                    continue
                if abs(la - lb) > 400:
                    continue
                seen.add(pair)
                evidence = self._find_relationship_evidence(text, a, b)
                relations.append(
                    {
                        "source": pair[0],
                        "target": pair[1],
                        "relation": "associate",
                        "evidence": evidence or f"Co-mentioned near each other: {a} / {b}",
                        "engine": "cooccurrence",
                    }
                )
        logger.info(f"Co-occurrence fallback: {len(relations)} relations")
        return relations

    # ========================================================
    # CDR / Bank
    # ========================================================

    def extract_from_cdr(self, csv_path: str) -> list[dict]:
        import pandas as pd

        relations = []
        try:
            df = pd.read_csv(csv_path)
            for idx, row in df.iterrows():
                from_num = str(
                    row.get("from_number", row.get("calling_number", ""))
                ).strip()
                to_num = str(
                    row.get("to_number", row.get("called_number", ""))
                ).strip()
                if not from_num or not to_num:
                    continue
                relations.append(
                    {
                        "source": from_num,
                        "target": to_num,
                        "relation": "phone_call",
                        "evidence": (
                            f"CDR row {idx + 1} @ {row.get('timestamp', 'unknown')} "
                            f"(Duration: {row.get('duration', 'N/A')}s)"
                        ),
                        "engine": "cdr",
                    }
                )
        except Exception as e:
            logger.error(f"CDR parsing failed: {e}")
        return relations

    def extract_from_bank(self, csv_path: str) -> list[dict]:
        import pandas as pd

        relations = []
        try:
            df = pd.read_csv(csv_path)
            for idx, row in df.iterrows():
                from_acc = str(
                    row.get("from_account", row.get("debit_account", ""))
                ).strip()
                to_acc = str(
                    row.get("to_account", row.get("credit_account", ""))
                ).strip()
                amount = row.get("amount", row.get("transaction_amount", "N/A"))
                if not from_acc or not to_acc:
                    continue
                relations.append(
                    {
                        "source": from_acc,
                        "target": to_acc,
                        "relation": "financial_transfer",
                        "evidence": f"{amount} INR @ {row.get('timestamp', 'unknown')}",
                        "engine": "bank",
                    }
                )
        except Exception as e:
            logger.error(f"Bank parsing failed: {e}")
        return relations


# ============================================================
# Shared singleton + convenience exports
# ============================================================

_shared_extractor = None


def get_shared_extractor() -> NLPExtractor:
    global _shared_extractor
    if _shared_extractor is None:
        _shared_extractor = NLPExtractor()
    return _shared_extractor


# `get_extractor` is the name the LangGraph agents use; keep both so either
# spelling resolves to the same singleton.
get_extractor = get_shared_extractor


def extract_entities(
    text: str,
    source_name: str = "agent",
    case_id: Optional[str] = None,
    already_english: bool = False,
) -> EntityExtractionResponse:
    """
    Entity + relation extraction for the agent path.

    Returns the validated EntityExtractionResponse the LangGraph agents expect
    (`entity_agent`, `supervisor_agent`), rather than raw dicts. Labels with no
    EntityType equivalent are dropped, and anything still in Indic script after
    translation is filtered out so it never reaches the UI.
    """
    extractor = get_shared_extractor()
    warnings: list[str] = []

    work_text = text if already_english else extractor.ensure_english(text)
    if not already_english and work_text is not text:
        warnings.append("Text was auto-translated to English before extraction.")

    raw_entities, relations = extractor.extract_entities_and_relations(work_text)

    entities: list[Entity] = []
    for item in raw_entities:
        label = str(item.get("label") or "").upper()
        value = str(item.get("text") or "").strip()
        if not value:
            continue

        entity_type = _LABEL_MAP.get(label)
        if entity_type is None:
            continue                      # no column for WEAPON/DRUG/MONEY/etc.
        if contains_indic(value):         # final safety net before the UI
            continue

        attributes: dict[str, Any] = {
            "start": item.get("start"),
            "end": item.get("end"),
            "source_sentence": str(item.get("source_sentence", ""))[:200],
            "page": item.get("page", 1),
        }
        if case_id:
            attributes["case_id"] = case_id
        if item.get("gliner_label"):
            attributes["gliner_label"] = item["gliner_label"]

        entities.append(
            Entity(
                id=None,
                type=entity_type,
                value=value,
                confidence=float(item.get("confidence", 0.85)),
                extracted_from=source_name,
                layer="spacy" if label in _SPACY_LAYER_LABELS else "regex",
                attributes=attributes,
            )
        )

    # Co-occurrence fallback evidence always starts with "Co-mentioned".
    llm_used = bool(relations) and not all(
        str(r.get("evidence", "")).startswith("Co-mentioned") for r in relations
    )

    return EntityExtractionResponse(
        entities=entities,
        relations=relations,
        llm_used=llm_used,
        warnings=warnings,
    )


def extract_entities_with_spans(text: str) -> list[dict]:
    return get_shared_extractor().extract_entities_with_spans(text)


def extract_relationships(
    text: str, known_entities: Optional[list[str]] = None
) -> list[dict]:
    return get_shared_extractor().extract_relationships(text, known_entities)


def extract_from_cdr(csv_path: str) -> list[dict]:
    return get_shared_extractor().extract_from_cdr(csv_path)


def extract_from_bank(csv_path: str) -> list[dict]:
    return get_shared_extractor().extract_from_bank(csv_path)