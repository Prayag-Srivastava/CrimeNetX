"""
CrimeNetX — NLP Extractor (Pipeline v2.2 — Translation-Safe, 22 languages)
===========================================================================
WHAT CHANGED IN v2.2 (and WHY)
------------------------------
BUG: The frontend workflow reaches NER through the *agents*
     (entity_agent.py / supervisor_agent.py) which call the module-level
     extract_entities(). That path fed RAW Devanagari OCR text straight
     into spaCy's English model -> Hindi/garbage entities, and Groq also
     received Hindi text so relationships were poor.

     Only the standalone ForensicPipeline test path translated first,
     which is exactly why "it works in tests but not in the frontend".

FIX: NER is now TRANSLATION-SAFE at the source. `ensure_english()`
     detects the script and runs IndicTrans2 internally if the text is
     not Latin. Both entry paths (pipeline AND agents) now get English.

     - ForensicPipeline (already translated) -> ensure_english() is a
       no-op passthrough, zero double-translation cost.
     - Agents (raw Hindi) -> ensure_english() translates, then spaCy runs.

OTHER IMPROVEMENTS
------------------
  * Devanagari leakage guard: any entity still containing Indic script
    is dropped instead of surfacing in the UI.
  * Entity quality: noise filtering, title stripping ("Shri", "Smt"),
    PERSON name validation, dedup is now case/whitespace aware.
  * Regex hardening: PINCODE no longer eats phone fragments, IMEI vs
    bank-account disambiguation, LAW_SECTION handles "BNS 111" without
    the word "Section".
  * Groq: retries once, logs the real failure, no longer silently
    returns [] when GROQ_API_KEY is missing at import time.
  * extract_relationships() now maps LLM names back onto known entities
    so the graph nodes actually match the entity list.

BACKWARD COMPATIBLE: every public method name/signature is unchanged.
"""

import json
import logging
import re
import unicodedata
from typing import Optional

import spacy
from pydantic import BaseModel

from app.models.schemas import Entity, EntityExtractionResponse, EntityType
from app.config import SPACY_MODEL, GROQ_API_KEY

logger = logging.getLogger(__name__)


# ================================================================
# Groq model selection
# ================================================================
# `llama-3.3-70b-versatile` was DEPRECATED on 2026-06-17 and shut down on
# 2026-08-16 — it now returns 404 model_not_found for non-Enterprise keys.
# Groq's recommended replacement is openai/gpt-oss-120b.
#
# We try a chain so a future deprecation degrades instead of breaking:
# override with the GROQ_MODEL env var if you want to pin one.
_GROQ_MODEL_CHAIN = [
    "openai/gpt-oss-120b",    # recommended replacement, 500 tps, JSON mode
    "openai/gpt-oss-20b",     # faster/cheaper fallback, 1000 tps
    "qwen/qwen3.6-27b",       # alternate replacement
    "groq/compound-mini",     # last resort
]

# Remembers the first model that worked so we don't re-probe every call
_WORKING_GROQ_MODEL: Optional[str] = None


def _groq_model_candidates() -> list[str]:
    import os
    pinned = os.getenv("GROQ_MODEL", "").strip()
    if pinned:
        return [pinned] + [m for m in _GROQ_MODEL_CHAIN if m != pinned]
    return list(_GROQ_MODEL_CHAIN)


# ================================================================
# Script helpers — the core of the Hindi-entities fix
# ================================================================

# Every non-Latin script IndicTrans2 can translate from. Imported from the
# detector so there is ONE list — v2.1 hardcoded a short list here that was
# missing Ol Chiki (Santali), Meetei Mayek (Manipuri) and Thaana, so text in
# those scripts was wrongly treated as "already English" and never translated.
try:
    from app.services.language_detector import INDIC_SCRIPTS as _INDIC_SCRIPTS
except Exception:  # pragma: no cover - detector import must never break NER
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
    indic = sum(1 for c in letters if _script_of(c) in _INDIC_SCRIPTS)
    return indic / len(letters)


def is_probably_english(text: str, threshold: float = 0.10) -> bool:
    """True if the text is dominantly Latin script."""
    return indic_ratio(text) < threshold


def contains_indic(text: str) -> bool:
    return any(_script_of(c) in _INDIC_SCRIPTS for c in text if c.isalpha())


# ---- Pydantic schemas for Groq (unchanged contract) ----
class LlmRelation(BaseModel):
    source: str
    target: str
    relation: str   # family | associate | same_organization | phone_call | financial_transfer
    evidence: str


class LlmExtraction(BaseModel):
    relations: list[LlmRelation]


# ================================================================
# Noise filters for entity quality
# ================================================================

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


def _clean_person_name(raw: str) -> str:
    """Strip honorifics/role words, normalize whitespace."""
    txt = re.sub(r"\s+", " ", raw or "").strip(" .,:;-\"'()")
    if not txt:
        return ""
    tokens = txt.split()
    while tokens and tokens[0].lower().strip(".") in _TITLE_PREFIXES:
        tokens.pop(0)
    return " ".join(tokens).strip(" .,:;-")


def _is_valid_person(name: str) -> bool:
    if not name or len(name) < 3 or len(name) > 60:
        return False
    if contains_indic(name):          # Devanagari leakage guard
        return False
    if any(ch.isdigit() for ch in name):
        return False
    low = name.lower()
    if low in _PERSON_STOPWORDS:
        return False
    tokens = [t for t in name.split() if t]
    if not tokens or len(tokens) > 5:
        return False
    if all(t.lower() in _PERSON_STOPWORDS for t in tokens):
        return False
    # must contain at least one capitalised alphabetic token
    return any(t[0].isupper() and t.isalpha() for t in tokens)


class NLPExtractor:
    """
    NLP Extractor with translation-safe spaCy NER + Groq relationships.

    Pipeline calls:
        nlp.extract_entities_with_spans(text)          -> spaCy (auto-translates)
        nlp.extract_relationships(text, entities)      -> Groq (auto-translates)

    Legacy/agent calls:
        extract_entities(text)                         -> module-level wrapper
        nlp.extract_from_cdr(csv_path)                 -> direct parsing
        nlp.extract_from_bank(csv_path)                -> direct parsing
    """

    def __init__(self):
        try:
            self.nlp = spacy.load(SPACY_MODEL)
            logger.info(f"spaCy model loaded: {SPACY_MODEL}")
        except OSError:
            logger.warning(f"{SPACY_MODEL} not found, falling back to en_core_web_sm")
            try:
                self.nlp = spacy.load("en_core_web_sm")
            except OSError:
                logger.error("No spaCy model found. Run: python -m spacy download en_core_web_sm")
                self.nlp = None

        # Lazily-created translation helpers (heavy models — do NOT load eagerly)
        self._translator = None
        self._detector = None

        # Custom regex patterns for Indian entities
        self._phone_pattern = re.compile(
            r'(?<!\d)(?:\+91[\s\-]?|0)?(?:\d{5}[\s\-]\d{5}|[6-9]\d{9})(?!\d)'
        )
        self._imei_pattern = re.compile(r'(?<!\d)\d{15}(?!\d)')
        self._vehicle_pattern = re.compile(
            r'\b[A-Z]{2}[\s\-]?\d{1,2}[\s\-]?[A-Z]{1,3}[\s\-]?\d{4}\b'
        )
        self._law_pattern = re.compile(
            r'\b(?:BNS|BNSS|IPC|CrPC|IT\s?Act|NDPS|POCSO)\s*'
            r'(?:§|Sections?|Sec\.?)?\s*\d{1,4}(?:\s*\(\d+\))?[A-Z]?\b',
            re.IGNORECASE,
        )
        self._pincode_pattern = re.compile(
            r'(?<!\d)(?:PIN|Pin|pincode|Pincode|PIN\s?Code)[\s:\-]*([1-9]\d{5})(?!\d)'
        )
        self._bank_account_pattern = re.compile(
            r'(?:A/?c|Account|Acct)[\s.:No#\-]*(\d{9,18})(?!\d)', re.IGNORECASE
        )
        self._crypto_pattern = re.compile(
            r'\b(?:bc1[a-z0-9]{25,62}|0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b'
        )

    # ================================================================
    # NEW: translation guard — the actual fix
    # ================================================================
    def _get_translator(self):
        if self._translator is None:
            from app.services.translator import TranslatorService
            self._translator = TranslatorService()
        return self._translator

    def _get_detector(self):
        if self._detector is None:
            from app.services.language_detector import LanguageDetector
            self._detector = LanguageDetector()
        return self._detector

    def ensure_english(self, text: str) -> str:
        """
        Guarantee spaCy/Groq receive English.

        No-op when text is already Latin script (the ForensicPipeline case,
        since Stage 2 already translated). Runs IndicTrans2 when the caller
        handed us raw Devanagari (the agent / frontend case).
        """
        if not text or not text.strip():
            return text or ""

        if is_probably_english(text):
            return text

        ratio = round(indic_ratio(text), 2)
        logger.warning(
            f"ensure_english(): non-Latin text reached NER "
            f"(indic_ratio={ratio}). Translating inline before spaCy. "
            f"Caller should ideally translate upstream."
        )
        # NOTE: language is auto-detected across all 22 IndicTrans2 languages —
        # nothing here assumes Hindi.

        try:
            detection = self._get_detector().detect(text)

            if detection.is_english:
                logger.info(
                    "ensure_english(): detector says English despite non-Latin "
                    "characters — likely OCR noise. Skipping translation."
                )
                return text

            logger.info(
                f"ensure_english(): detected {detection.language} "
                f"({detection.indictrans_code}, script={detection.script}, "
                f"method={detection.method})"
            )

            translation = self._get_translator().translate(
                text,
                source_lang=detection.language,
                source_indictrans_code=detection.indictrans_code,
            )
            translated = getattr(translation, "translated_text", "") or ""
            ok = getattr(translation, "success", bool(translated))

            if ok and translated.strip() and is_probably_english(translated):
                logger.info(
                    f"ensure_english(): translated {detection.indictrans_code} -> eng_Latn "
                    f"({len(text)} -> {len(translated)} chars)"
                )
                return translated

            logger.error(
                "ensure_english(): translation produced unusable output "
                f"(success={ok}, len={len(translated)}). Falling back to original text."
            )
        except Exception as e:
            logger.error(f"ensure_english(): inline translation failed: {e}")

        return text

    # ================================================================
    # Stage 3: spaCy NER with source spans
    # ================================================================
    def extract_entities_with_spans(
        self,
        text: str,
        already_english: bool = False,
    ) -> list[dict]:
        """
        Extract entities using spaCy with character-level offsets.

        Args:
            text: FIR text (any language — translated automatically)
            already_english: set True by ForensicPipeline to skip the check

        Returns:
            [{"text", "label", "start", "end", "source_sentence", "page"}, ...]
        """
        if not self.nlp or not text:
            return []

        work_text = text if already_english else self.ensure_english(text)
        if not work_text:
            return []

        entities: list[dict] = []
        doc = self.nlp(work_text)

        # Build a sentence index once (O(n) instead of O(n*m))
        try:
            sents = [(s.start_char, s.end_char, s.text.strip()) for s in doc.sents]
        except Exception:
            sents = []

        def sentence_for(start: int, end: int) -> str:
            for s_start, s_end, s_text in sents:
                if s_start <= start and s_end >= end:
                    return s_text[:200]
            return ""

        for ent in doc.ents:
            label = ent.label_
            value = ent.text.strip()

            if label in ("PERSON", "PER"):
                value = _clean_person_name(value)
                if not _is_valid_person(value):
                    continue
            else:
                if contains_indic(value):     # Devanagari leakage guard
                    continue
                if len(value) < 2:
                    continue

            entities.append({
                "text": value,
                "label": label,
                "start": ent.start_char,
                "end": ent.end_char,
                "source_sentence": sentence_for(ent.start_char, ent.end_char),
                "page": 1,
            })

        entities.extend(self._extract_custom_entities(work_text, sentence_for))
        entities = self._deduplicate_entities(entities)

        logger.info(
            f"spaCy NER: {len(entities)} entities "
            f"({sum(1 for e in entities if e['label'] in ('PERSON', 'PER'))} persons, "
            f"{sum(1 for e in entities if e['label'] in ('GPE', 'LOC'))} locations, "
            f"{sum(1 for e in entities if e['label'] == 'ORG')} orgs, "
            f"{sum(1 for e in entities if e['label'] == 'PHONE')} phones)"
        )
        return entities

    def _extract_custom_entities(self, text: str, sentence_for) -> list[dict]:
        """Extract Indian-specific entities using regex patterns."""
        custom: list[dict] = []

        # (label, pattern, capture_group)
        patterns = [
            ("PHONE",        self._phone_pattern,        0),
            ("VEHICLE",      self._vehicle_pattern,      0),
            ("LAW_SECTION",  self._law_pattern,          0),
            ("CRYPTO_WALLET", self._crypto_pattern,      0),
            ("BANK_ACCOUNT", self._bank_account_pattern, 1),
            ("PINCODE",      self._pincode_pattern,      1),
            ("IMEI",         self._imei_pattern,         0),
        ]

        claimed: list[tuple[int, int]] = []

        for label, pattern, group in patterns:
            for match in pattern.finditer(text):
                start, end = match.span(group)
                value = match.group(group).strip()

                if len(value) < 4:
                    continue
                # skip if this span is inside an already-claimed higher-priority span
                if any(s <= start and end <= e for s, e in claimed):
                    continue

                claimed.append((start, end))
                custom.append({
                    "text": value,
                    "label": label,
                    "start": start,
                    "end": end,
                    "source_sentence": sentence_for(start, end),
                    "page": 1,
                })

        return custom

    def _deduplicate_entities(self, entities: list[dict]) -> list[dict]:
        """Remove overlapping spans (keep longest) and exact value repeats."""
        if not entities:
            return []

        entities.sort(key=lambda e: (e["start"], -(e["end"] - e["start"])))

        deduped: list[dict] = []
        last_end = -1
        for ent in entities:
            if ent["start"] >= last_end:
                deduped.append(ent)
                last_end = ent["end"]
            elif deduped and (ent["end"] - ent["start"]) > (deduped[-1]["end"] - deduped[-1]["start"]):
                deduped[-1] = ent
                last_end = ent["end"]

        # collapse duplicate (label, normalized value) — keep first occurrence
        seen: set[tuple[str, str]] = set()
        unique: list[dict] = []
        for ent in deduped:
            key = (ent["label"], re.sub(r"\s+", " ", ent["text"]).strip().lower())
            if key in seen:
                continue
            seen.add(key)
            unique.append(ent)

        return unique

    # ================================================================
    # Stage 5: Groq relationship extraction
    # ================================================================
    def extract_relationships(
        self,
        text: str,
        known_entities: Optional[list[str]] = None,
        already_english: bool = False,
    ) -> list[dict]:
        """Extract relationships using Groq LLM, with co-occurrence fallback."""
        if not text or len(text.strip()) < 50:
            return []

        work_text = text if already_english else self.ensure_english(text)

        try:
            relations = self._llm_layer(work_text, known_entities)
            if relations:
                relations = self._align_to_known(relations, known_entities)
                logger.info(f"Groq relationships: {len(relations)} extracted")
                return relations
            logger.warning("Groq returned zero relations — using co-occurrence fallback")
        except Exception as e:
            logger.warning(f"Groq relationship extraction failed: {e}")

        return self._cooccurrence_relations(work_text)

    @staticmethod
    def _align_to_known(relations: list[dict], known: Optional[list[str]]) -> list[dict]:
        """Snap LLM-returned names onto the canonical entity list so graph nodes match."""
        if not known:
            return relations

        lookup = {k.strip().lower(): k for k in known if k}

        def snap(name: str) -> str:
            n = (name or "").strip()
            low = n.lower()
            if low in lookup:
                return lookup[low]
            for k_low, k_orig in lookup.items():
                if low and (low in k_low or k_low in low):
                    return k_orig
            return n

        out = []
        for r in relations:
            src, tgt = snap(r.get("source", "")), snap(r.get("target", ""))
            if not src or not tgt or src == tgt:
                continue
            out.append({**r, "source": src, "target": tgt})
        return out

    def _llm_layer(
        self,
        text: str,
        known_entities: Optional[list[str]] = None,
    ) -> list[dict]:
        """Groq LLM relationship extraction with automatic model fallback."""
        # Re-read env at call time — avoids the "key loaded after import" trap
        api_key = GROQ_API_KEY
        if not api_key:
            import os
            api_key = os.getenv("GROQ_API_KEY", "")
        if not api_key:
            logger.error("GROQ_API_KEY missing — relationship extraction disabled")
            return []

        from groq import Groq
        client = Groq(api_key=api_key)

        entity_hint = ""
        if known_entities:
            uniq = list(dict.fromkeys([e for e in known_entities if e]))[:25]
            entity_hint = (
                "\nUse EXACTLY these names when they apply (do not invent or "
                f"rename people): {', '.join(uniq)}"
            )

        prompt = f"""Extract all relationships between people mentioned in this FIR text.

For each relationship, provide:
- source: name of first person
- target: name of second person
- relation: one of [family, associate, same_organization, phone_call, financial_transfer]
- evidence: the EXACT sentence from the text that proves this relationship

Rules:
- Only include relationships explicitly supported by the text.
- Do not output a relationship between a person and themselves.
- If no relationships exist, return {{"relations": []}}.
{entity_hint}

FIR Text:
{text[:6000]}

Respond with JSON: {{"relations": [{{"source": "...", "target": "...", "relation": "...", "evidence": "..."}}]}}"""

        global _WORKING_GROQ_MODEL

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a crime intelligence analyst. Extract relationships "
                    "from FIR text. Respond only with valid JSON."
                ),
            },
            {"role": "user", "content": prompt},
        ]

        # Try the known-good model first, then walk the chain
        candidates = (
            [_WORKING_GROQ_MODEL] if _WORKING_GROQ_MODEL else []
        ) + [m for m in _groq_model_candidates() if m != _WORKING_GROQ_MODEL]

        last_error = None
        for model_name in candidates:
            for attempt in (1, 2):
                try:
                    response = client.chat.completions.create(
                        model=model_name,
                        messages=messages,
                        temperature=0.1,
                        response_format={"type": "json_object"},
                    )
                    parsed = json.loads(response.choices[0].message.content)
                    extraction = LlmExtraction.model_validate(parsed)

                    if _WORKING_GROQ_MODEL != model_name:
                        logger.info(f"Groq model in use: {model_name}")
                        _WORKING_GROQ_MODEL = model_name

                    return [
                        {
                            "source": r.source.strip(),
                            "target": r.target.strip(),
                            "relation": r.relation,
                            "evidence": r.evidence,
                        }
                        for r in extraction.relations
                        if r.source and r.target
                    ]
                except Exception as e:
                    last_error = e
                    msg = str(e)

                    # Model gone/unavailable — don't retry, move to next model
                    if any(
                        tok in msg
                        for tok in (
                            "model_not_found",
                            "does not exist",
                            "decommissioned",
                            "model_decommissioned",
                        )
                    ):
                        logger.warning(
                            f"Groq model '{model_name}' unavailable — trying next. "
                            f"(Set GROQ_MODEL env var to pin a specific model.)"
                        )
                        if _WORKING_GROQ_MODEL == model_name:
                            _WORKING_GROQ_MODEL = None
                        break

                    logger.warning(f"Groq [{model_name}] attempt {attempt}/2 failed: {e}")

        logger.error(
            f"LLM layer failed on all candidate models "
            f"{candidates}: {last_error}"
        )
        return []

    def _cooccurrence_relations(self, text: str) -> list[dict]:
        """Fallback: paragraph-level person co-occurrence."""
        if not self.nlp:
            return []

        paragraphs = [p for p in text.split("\n\n") if len(p.strip()) >= 30]
        relations: list[dict] = []
        seen_pairs: set[tuple[str, str]] = set()

        for para in paragraphs:
            para_doc = self.nlp(para)
            persons = []
            for ent in para_doc.ents:
                if ent.label_ in ("PERSON", "PER"):
                    name = _clean_person_name(ent.text)
                    if _is_valid_person(name) and name not in persons:
                        persons.append(name)

            for i in range(len(persons)):
                for j in range(i + 1, len(persons)):
                    pair = tuple(sorted([persons[i], persons[j]]))
                    if pair in seen_pairs:
                        continue
                    seen_pairs.add(pair)
                    relations.append({
                        "source": pair[0],
                        "target": pair[1],
                        "relation": "associate",
                        "evidence": f"Co-mentioned in FIR paragraph: {para[:100]}...",
                    })

        logger.info(f"Co-occurrence fallback: {len(relations)} relations")
        return relations

    # ================================================================
    # KEPT AS-IS: Direct CDR/Bank ingestion
    # ================================================================
    def extract_from_cdr(self, csv_path: str) -> list[dict]:
        """Parse CDR CSV. UNCHANGED from original."""
        import pandas as pd
        relations = []
        try:
            df = pd.read_csv(csv_path)
            for idx, row in df.iterrows():
                from_num = str(row.get("from_number", row.get("calling_number", "")))
                to_num = str(row.get("to_number", row.get("called_number", "")))
                if from_num and to_num:
                    relations.append({
                        "source": from_num,
                        "target": to_num,
                        "relation": "phone_call",
                        "evidence": (
                            f"CDR row {idx + 1} @ "
                            f"{row.get('timestamp', row.get('date', 'unknown'))} "
                            f"(Duration: {row.get('duration', 'N/A')}s)"
                        ),
                    })
        except Exception as e:
            logger.error(f"CDR parsing failed: {e}")
        return relations

    def extract_from_bank(self, csv_path: str) -> list[dict]:
        """Parse Bank CSV. UNCHANGED from original."""
        import pandas as pd
        relations = []
        try:
            df = pd.read_csv(csv_path)
            for idx, row in df.iterrows():
                from_acc = str(row.get("from_account", row.get("debit_account", "")))
                to_acc = str(row.get("to_account", row.get("credit_account", "")))
                amount = row.get("amount", row.get("transaction_amount", "N/A"))
                if from_acc and to_acc:
                    relations.append({
                        "source": from_acc,
                        "target": to_acc,
                        "relation": "financial_transfer",
                        "evidence": (
                            f"{amount} INR @ "
                            f"{row.get('timestamp', row.get('date', 'unknown'))}"
                        ),
                    })
        except Exception as e:
            logger.error(f"Bank parsing failed: {e}")
        return relations


# ================================================================
# Backward-compatible module-level entity extraction
# Used by entity_agent.py and supervisor_agent.py  <-- the frontend path
# ================================================================

_LABEL_MAP = {
    "PERSON": EntityType.PERSON,
    "PER": EntityType.PERSON,
    "GPE": EntityType.LOCATION,
    "LOC": EntityType.LOCATION,
    "LOCATION": EntityType.LOCATION,
    "FAC": EntityType.LOCATION,
    "ORG": EntityType.ORGANIZATION,
    "ORGANIZATION": EntityType.ORGANIZATION,
    "PHONE": EntityType.PHONE,
    "VEHICLE": EntityType.VEHICLE,
    "BANK_ACCOUNT": EntityType.BANK_ACCOUNT,
    "DATE": EntityType.DATE,
    "ALIAS": EntityType.ALIAS,
    "CRYPTO_WALLET": EntityType.CRYPTO_WALLET,
}

_SPACY_LAYER_LABELS = {
    "PERSON", "PER", "GPE", "LOC", "LOCATION", "FAC",
    "ORG", "ORGANIZATION", "DATE",
}

# Reuse one extractor — spaCy load is expensive and was previously
# re-instantiated on every single agent call.
_SHARED_EXTRACTOR: Optional[NLPExtractor] = None


def get_extractor() -> NLPExtractor:
    global _SHARED_EXTRACTOR
    if _SHARED_EXTRACTOR is None:
        _SHARED_EXTRACTOR = NLPExtractor()
    return _SHARED_EXTRACTOR


def extract_entities(
    text: str,
    source_name: str = "agent",
    case_id: Optional[str] = None,
    already_english: bool = False,
) -> EntityExtractionResponse:
    """
    Compatibility wrapper for the agentic pipeline.

    v2.2: now translation-safe. If `text` arrives in Devanagari (which is
    what was happening from the frontend upload flow), it is translated to
    English via IndicTrans2 before spaCy NER runs.
    """
    extractor = get_extractor()
    warnings: list[str] = []

    work_text = text if already_english else extractor.ensure_english(text)
    if not already_english and work_text is not text:
        warnings.append("Text was auto-translated to English before NER.")

    raw_entities = extractor.extract_entities_with_spans(work_text, already_english=True)

    entities: list[Entity] = []
    for item in raw_entities:
        label = (item.get("label") or "").upper()
        value = (item.get("text") or "").strip()
        if not value:
            continue

        entity_type = _LABEL_MAP.get(label)
        if entity_type is None:
            continue
        if contains_indic(value):     # final safety net before the UI
            continue

        entities.append(
            Entity(
                id=None,
                type=entity_type,
                value=value,
                confidence=0.85 if label in _SPACY_LAYER_LABELS else 0.95,
                extracted_from=source_name,
                layer="spacy" if label in _SPACY_LAYER_LABELS else "regex",
                attributes={
                    "start": item.get("start"),
                    "end": item.get("end"),
                    "source_sentence": item.get("source_sentence", ""),
                    "page": item.get("page", 1),
                    **({"case_id": case_id} if case_id else {}),
                },
            )
        )

    known_entity_names = [e.value for e in entities if e.type == EntityType.PERSON]

    relations = extractor.extract_relationships(
        work_text,
        known_entities=known_entity_names,
        already_english=True,
    )

    llm_used = bool(relations) and not all(
        r.get("evidence", "").startswith("Co-mentioned") for r in relations
    )

    if not relations:
        warnings.append("No relationships extracted.")

    logger.info(
        f"extract_entities(): {len(entities)} entities, "
        f"{len(relations)} relations, llm_used={llm_used}, source={source_name}"
    )

    return EntityExtractionResponse(
        entities=entities,
        relations=relations,
        llm_used=llm_used,
        warnings=warnings,
    )
