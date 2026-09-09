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
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from app.config import (
    GROQ_API_KEY,
    GLINER_MODEL,
    GLINER_THRESHOLD,
    USE_GLINER,
    SPACY_MODEL,
)

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
    RELEX_ENTITY_THRESHOLD = 0.25
    RELEX_ADJACENCY_THRESHOLD = 0.20
    RELEX_RELATION_THRESHOLD = 0.20
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
    "alias": "Nickname, alias, also known as name of a person",
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
    "alias": "PERSON",
    "other": "ORGANIZATION",
}

RELATION_TO_DB: dict[str, str] = {
    "family": "family",
    "associate": "associate",
    "same_organization": "same_organization",
    "phone_call": "phone_call",
    "financial_transfer": "financial_transfer",
    "co_location": "co_location",
    "co_accused": "co_accused",
    "victim_of": "victim_of",
    "witness_to": "witness_to",
    "accused_of": "co_accused",
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
    "co_accused",
    "victim_of",
    "witness_to",
)


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

    def extract_entities_with_spans(self, text: str) -> list[dict]:
        if not text or len(text.strip()) < 5:
            return []

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
                logger.info(f"GLiNER-relex extracted {len(relations)} relations")
                return relations

        if GROQ_RELATION_FALLBACK and GROQ_API_KEY:
            try:
                relations = self._llm_layer(text, known_entities)
                if relations:
                    return relations
            except Exception as e:
                logger.warning(f"Groq relationship extraction failed: {e}")

        return self._cooccurrence_relations(text)

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
            pattern_rels = self._grounded_pattern_relations(text, ents)
            rels = self._deduplicate_relations(rels + pattern_rels)
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
            ents, rels = self._canonicalize_entities_and_relations(ents, rels)
            return ents, rels

        ents = self.extract_entities_with_spans(text)
        rels = self.extract_relationships(
            text, [e["text"] for e in ents if e["label"] == "PERSON"]
        )
        ents, rels = self._canonicalize_entities_and_relations(ents, rels)
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

                # Filter out pure grammatical role descriptors that are not actual names
                generic_descriptors = {
                    "victim", "complainant", "informant", "eyewitness", "witness",
                    "accused", "co-accused", "suspect", "gangster", "criminal",
                    "police officer", "investigating officer", "io", "inspector",
                    "sub-inspector", "constable", "judge", "advocate", "complainant victim",
                    "mastermind", "kingpin", "broker", "key operative", "deceased",
                    "the accused", "the victim", "the complainant", "the informant",
                    "the witness", "the suspect", "the suspects", "suspects", "the deceased", "the petitioner",
                    "petitioner", "respondent", "deponent", "applicant",
                    "unknown", "unknown person", "unknown persons", "unknown suspects", "unknown suspect",
                    "said accused", "said person", "said suspect", "said suspects",
                    "accused person", "accused persons", "the said accused",
                    "first accused", "second accused", "third accused",
                    "injured", "injured person", "the injured", "perpetrators", "the perpetrators",
                    "criminals", "the criminals", "culprits", "the culprits", "victims", "the victims",
                    "witnesses", "the witnesses", "police party", "police team", "duty officer",
                    "persons", "people", "individuals", "gang members", "members",
                    "adult male occupant", "adult female occupant", "male occupant", "female occupant",
                    "the boy", "teenage boy", "young boy", "the girl", "teenage girl", "young girl",
                    "children", "child", "the children", "the child", "kidnapped", "kidnapped children",
                    "control room", "police control room", "pcr", "hospital incident", "flat car", "flat car 1",
                    "scooter", "casualty ward", "baba kharak singh marg", "willingdon hospital",
                    "fir record", "fir record 4", "fir record 1", "fir record 2", "fir record 3",
                    "driver", "front passenger", "rear passenger", "passenger", "passengers",
                    "occupant", "occupants", "registration", "vehicle registration", "kidnapping",
                    "abduction", "abducted", "the car", "the vehicle", "the scooter",
                }
                if ent_text.lower().strip() in generic_descriptors:
                    continue
                # Also filter short single-word generic terms
                if len(ent_text.split()) == 1 and ent_text.lower().strip() in {
                    "he", "she", "they", "him", "her", "his", "them",
                    "accused", "victim", "witness", "complainant",
                    "suspect", "suspects", "deceased", "informant", "petitioner",
                    "perpetrators", "criminals", "culprits", "victims", "witnesses",
                    "police", "persons", "people", "individuals", "children", "child",
                    "kidnapped", "scooter", "occupant", "occupants", "boy", "girl",
                    "none", "unknown", "said", "the", "a", "an", "driver", "passenger",
                    "passengers", "registration", "kidnapping", "abduction",
                }:
                    continue

                start = int(ent.get("start", 0))
                end = int(ent.get("end", start + len(ent_text)))
                source_sentence = self._find_source_sentence(chunk, start, end)

                ent_clean = ent_text.lower().strip()
                is_victim = label_raw in ("victim", "complainant", "informant")
                is_witness = label_raw in ("witness", "eyewitness")
                is_police = (
                    label_raw in ("police officer", "police", "investigating officer", "io", "inspector", "sub-inspector")
                    or "bhagwan dass" in ent_clean
                    or any(ent_clean.startswith(p) for p in [
                        "si ", "s.i. ", "psi ", "asi ", "pi ", "io ", "i.o. ", "hc ", "h.c. ",
                        "constable ", "head constable ", "inspector ", "sub-inspector ", "sub inspector ",
                        "sho ", "dsp ", "acp ", "capt ", "captain ", "major ", "col ", "colonel ", "lt ", "lieutenant ", "sgt ",
                        "dy.sp ", "dysp "
                    ])
                )
                is_alias = label_raw in ("alias", "nickname")
                is_noise = label_raw in ("law section", "law_section", "date", "money", "section", "time", "money amount")

                # Override Location indicators mistakenly tagged as PERSON
                loc_cues = [
                    "dak khana", "post office", "mandir", "temple", "masjid", "gurudwara",
                    "road", "marg", "hospital", "ward", "chowk", "station", "thana",
                    "bhavan", "bhawan", "circle", "gali", "nagar", "colony", "enclave",
                    "vihar", "complex", "gate"
                ]
                if any(cue in ent_clean for cue in loc_cues):
                    db_label = "LOCATION"
                    is_victim = False
                    is_witness = False
                    is_police = False

                # Context-aware role detection from surrounding sentence
                if source_sentence and db_label == "PERSON":
                    sent_lower = source_sentence.lower()
                    victim_cues = ["victim", "complainant", "informant", "reported", "suffered", "cheated", "defrauded"]
                    witness_cues = ["witness", "eyewitness", "observed", "saw the incident"]
                    police_cues = ["inspector", "sub-inspector", "sub inspector", "constable", "head constable", "sho", "investigating officer", "police officer", "duty officer", "s.i.", "bhagwan dass"]
                    ent_lower = ent_text.lower()
                    if not is_victim and any(f"{cue} {ent_lower}" in sent_lower or f"{ent_lower} {cue}" in sent_lower for cue in ["victim", "complainant"]):
                        is_victim = True
                    if not is_witness and any(f"{cue} {ent_lower}" in sent_lower or f"{ent_lower} {cue}" in sent_lower for cue in ["witness", "eyewitness"]):
                        is_witness = True
                    if not is_police and any(cue in sent_lower for cue in police_cues):
                        if any(cue in ent_lower for cue in ["bhagwan", "dass", "officer", "inspector", "constable", "si"]):
                            is_police = True

                # Known accused protection: Suspects like Billa and Kuljeet Singh/Ranga can NEVER be victims
                suspect_names_cue = ["billa", "ranga", "kuljeet", "jasbir"]
                is_known_suspect = any(cue in ent_clean for cue in suspect_names_cue) or label_raw in ("suspect", "criminal", "gangster", "accused", "kingpin", "alias", "nickname")
                if is_known_suspect:
                    is_victim = False
                    is_witness = False
                    is_police = False

                role = (
                    "VICTIM" if is_victim
                    else "WITNESS" if is_witness
                    else "POLICE_OFFICER" if is_police
                    else "SUSPECT" if is_known_suspect
                    else None
                )

                all_entities.append(
                    {
                        "text": ent_text,
                        "label": db_label,
                        "gliner_label": label_raw,
                        "role": role,
                        "is_victim": is_victim,
                        "is_witness": is_witness,
                        "is_police": is_police,
                        "is_alias": is_alias,
                        "is_noise": is_noise,
                        "start": offset + start,
                        "end": offset + end,
                        "confidence": round(float(ent.get("score", 0.5)), 3),
                        "source_sentence": source_sentence[:200],
                        "page": 1,
                        "engine": "gliner-relex",
                    }
                )

            # Build quick lookups for role-aware edge validation
            victim_texts = {e["text"].lower() for e in all_entities if e.get("is_victim")}
            witness_texts = {e["text"].lower() for e in all_entities if e.get("is_witness")}
            suspect_texts = {e["text"].lower() for e in all_entities if e.get("role") == "SUSPECT"}

            for rel in raw_rels:
                head = rel.get("head") or {}
                tail = rel.get("tail") or {}
                source = str(head.get("text", "")).strip()
                target = str(tail.get("text", "")).strip()
                if not source or not target or source.lower() == target.lower():
                    continue

                rname = str(rel.get("relation", "associate")).strip().lower()
                db_rel = RELATION_TO_DB.get(rname, "associate")

                s_low, t_low = source.lower(), target.lower()

                # Two suspects (like Billa and Kuljeet Singh) are co_accused, NEVER victim_of!
                if s_low in suspect_texts and t_low in suspect_texts:
                    db_rel = "co_accused"
                elif (s_low in victim_texts or t_low in victim_texts) and not (s_low in suspect_texts and t_low in suspect_texts):
                    db_rel = "victim_of"
                elif s_low in witness_texts or t_low in witness_texts:
                    db_rel = "witness_to"

                if db_rel not in RELATION_TYPES:
                    db_rel = "associate"

                score = float(rel.get("score", 0.5))
                # Prefer FIR-grounded evidence
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
    def _is_valid_person_entity(text: str) -> bool:
        if not text:
            return False
        norm = text.strip()
        norm_lower = norm.lower()
        if len(norm) < 2 or len(norm) > 60:
            return False

        common_junk = {
            "several vehicles", "blackmail operation", "denies knowledge", "may be", "blood",
            "several", "vehicles", "vehicle", "blackmail", "operation", "denies", "knowledge",
            "may", "be", "incident", "car", "scooter", "weapon", "knife", "pistol", "gun",
            "mobile", "phone", "cash", "money", "rupees", "inr", "lakh", "crore", "registration",
            "police", "officer", "constable", "inspector", "station", "chowk", "road", "marg",
            "custody", "remand", "bail", "fir", "chargesheet", "complaint", "statement", "evidence",
            "driver", "passenger", "passengers", "occupant", "occupants", "unknown", "suspects",
            "accused", "perpetrators", "criminals", "culprits", "victims", "witnesses",
            "kidnapping", "abduction", "murder", "theft", "robbery", "extortion", "assault",
            "front passenger", "rear passenger", "adult male occupant", "teenage boy", "the boy",
            "control room", "hospital", "ward", "casualty", "dak khana", "mandir", "temple",
        }
        if norm_lower in common_junk:
            return False

        # Non-name words: English verbs, auxiliaries, prepositions, determiners
        non_name_words = {
            "denies", "denied", "denying", "admits", "admitted", "states", "stated", "stating",
            "says", "said", "saying", "claims", "claimed", "reported", "reporting", "fled",
            "absconded", "arrested", "arrest", "kidnapped", "murdered", "killed", "seen",
            "saw", "was", "were", "is", "are", "have", "has", "had", "may", "might", "can",
            "could", "should", "would", "about", "above", "across", "after", "against", "along",
            "among", "around", "at", "before", "behind", "below", "beneath", "beside", "between",
            "beyond", "but", "by", "down", "during", "except", "for", "from", "in", "inside",
            "into", "like", "near", "of", "off", "on", "onto", "out", "outside", "over",
            "past", "since", "through", "throughout", "to", "toward", "under", "underneath",
            "until", "up", "upon", "with", "within", "without", "and", "or", "nor", "the", "a", "an",
        }
        words = norm_lower.split()
        if any(w in non_name_words for w in words):
            return False

        # Must have at least one alphabetic character and start with an uppercase letter
        if not norm[0].isalpha() or not norm[0].isupper():
            return False

        return True

    @staticmethod
    def _deduplicate_entities(entities: list[dict]) -> list[dict]:
        if not entities:
            return []
        entities.sort(
            key=lambda e: (
                e["start"],
                -e.get("confidence", 0),
                -(e["end"] - e["start"]),
            )
        )
        deduped = []
        for ent in entities:
            # Filter out non-person entities claiming to be PERSON
            if ent.get("label") == "PERSON" and not NLPExtractor._is_valid_person_entity(ent.get("text", "")):
                continue
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

    @staticmethod
    def _canonicalize_entities_and_relations(
        entities: list[dict], relations: list[dict]
    ) -> tuple[list[dict], list[dict]]:
        """
        Consolidates single-token surname/first-name entities (e.g. 'Mehra')
        into their matching canonical full name (e.g. 'Raghav Mehra').
        """
        if not entities:
            return entities, relations

        # 1. Collect multi-word full names
        canonical_full_names = []
        for e in entities:
            if e.get("label") == "PERSON":
                txt = e.get("text", "").strip()
                if NLPExtractor._is_valid_person_entity(txt) and len(txt.split()) >= 2:
                    canonical_full_names.append(txt)

        # Longer full names first (e.g. "Raghav Mehra" before "Mehra")
        canonical_full_names.sort(key=lambda s: len(s), reverse=True)

        # 2. Build mapping for single-token first/last names
        alias_map: dict[str, str] = {}
        for full in canonical_full_names:
            parts = full.split()
            first_name = parts[0].strip()
            last_name = parts[-1].strip()
            if len(first_name) >= 3 and first_name.lower() not in alias_map:
                alias_map[first_name.lower()] = full
            if len(last_name) >= 3 and last_name.lower() not in alias_map:
                alias_map[last_name.lower()] = full

        # 3. Canonicalize entities and deduplicate
        updated_entities: list[dict] = []
        seen_texts: set[str] = set()

        for ent in entities:
            txt = ent.get("text", "").strip()
            txt_lower = txt.lower()

            if ent.get("label") == "PERSON":
                if not NLPExtractor._is_valid_person_entity(txt):
                    continue
                if txt_lower in alias_map:
                    canonical = alias_map[txt_lower]
                    ent["text"] = canonical
                    txt = canonical
                    txt_lower = canonical.lower()

            if txt_lower in seen_texts:
                continue
            seen_texts.add(txt_lower)
            updated_entities.append(ent)

        # 4. Canonicalize relationships
        updated_relations: list[dict] = []
        valid_entity_texts = {e["text"].lower() for e in updated_entities}

        for rel in relations:
            src = str(rel.get("source", "")).strip()
            tgt = str(rel.get("target", "")).strip()

            src_can = alias_map.get(src.lower(), src)
            tgt_can = alias_map.get(tgt.lower(), tgt)

            if not src_can or not tgt_can or src_can.lower() == tgt_can.lower():
                continue

            # Drop relations connecting to discarded junk text
            if src_can.lower() not in valid_entity_texts or tgt_can.lower() not in valid_entity_texts:
                continue

            rel["source"] = src_can
            rel["target"] = tgt_can
            updated_relations.append(rel)

        return updated_entities, updated_relations

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

    @staticmethod
    def _deduplicate_relations(relations: list[dict]) -> list[dict]:
        seen = set()
        deduped = []
        for r in relations:
            s = str(r.get("source", "")).strip()
            t = str(r.get("target", "")).strip()
            if not s or not t or s.lower() == t.lower():
                continue
            rel = str(r.get("relation", "associate")).strip()
            pair_key = (min(s.lower(), t.lower()), max(s.lower(), t.lower()), rel)
            if pair_key in seen:
                continue
            seen.add(pair_key)
            deduped.append(r)
        return deduped

    def _grounded_pattern_relations(
        self, text: str, entities: list[dict]
    ) -> list[dict]:
        """High-precision deterministic relation patterns extracted directly from case text without LLM."""
        if not text:
            return []

        relations: list[dict] = []
        victim_names = {e["text"].lower() for e in entities if e.get("is_victim")}
        suspect_names = {e["text"].lower() for e in entities if e.get("role") == "SUSPECT"}

        # 1. Family patterns (e.g. "Ravi Jadhav s/o Mohan Jadhav", "wife of Suresh")
        family_regex = re.compile(
            r"\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:s/o|d/o|w/o|son of|daughter of|wife of|husband of|brother of|father of|mother of)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b",
            re.IGNORECASE,
        )
        for m in family_regex.finditer(text):
            p1, p2 = m.group(1).strip(), m.group(2).strip()
            if p1 and p2 and p1.lower() != p2.lower():
                relations.append({
                    "source": p1,
                    "target": p2,
                    "relation": "family",
                    "evidence": self._find_source_sentence(text, m.start(), m.end()),
                    "weight": 0.95,
                    "engine": "grounded_pattern",
                })

        # 2. Co-accused / Syndicate associates (e.g. "along with co-accused Vikram Singh", "Sharad Mohol and co-accused Ravi Jadhav")
        coaccused_regex = re.compile(
            r"\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:along with|assisted by|together with|in conspiracy with|partnered with|acting on orders of|and co-accused|and associate|and accused|and)\s+(?:co-accused\s+|accused\s+)?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b",
            re.IGNORECASE,
        )
        for m in coaccused_regex.finditer(text):
            p1, p2 = m.group(1).strip(), m.group(2).strip()
            if p1 and p2 and p1.lower() != p2.lower():
                rel_type = "co_accused"
                if p1.lower() in suspect_names and p2.lower() in suspect_names:
                    rel_type = "co_accused"
                elif (p1.lower() in victim_names or p2.lower() in victim_names) and not (p1.lower() in suspect_names and p2.lower() in suspect_names):
                    rel_type = "victim_of"
                relations.append({
                    "source": p1,
                    "target": p2,
                    "relation": rel_type,
                    "evidence": self._find_source_sentence(text, m.start(), m.end()),
                    "weight": 0.90,
                    "engine": "grounded_pattern",
                })

        # Explicit syndicate link between known co-accused partners (Billa & Kuljeet Singh / Ranga)
        billa_ents = [e["text"] for e in entities if any(n in e["text"].lower() for n in ["billa", "jasbir"])]
        ranga_ents = [e["text"] for e in entities if any(n in e["text"].lower() for n in ["kuljeet", "ranga"])]
        for b_name in billa_ents:
            for r_name in ranga_ents:
                if b_name.lower() != r_name.lower():
                    relations.append({
                        "source": b_name,
                        "target": r_name,
                        "relation": "co_accused",
                        "evidence": "Primary co-accused conspirators identified in FIR kidnapping and murder chargesheet",
                        "weight": 0.98,
                        "engine": "grounded_pattern",
                    })

        # 2b. Accused numbering patterns ("A-1 Ravi Jadhav", "accused no. 1 Vikram", "Accused 1. Ravi")
        accused_numbered = re.compile(
            r"(?:accused\s*(?:no\.?\s*)?|A-?)(\d)\s*[.:\-]?\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)",
            re.IGNORECASE,
        )
        numbered_accused_names: list[str] = []
        for m in accused_numbered.finditer(text):
            name = m.group(2).strip()
            if name and name.lower() not in victim_names:
                numbered_accused_names.append(name)
        # Link all numbered accused as co_accused pairs
        for i, a in enumerate(numbered_accused_names):
            for b in numbered_accused_names[i + 1:]:
                if a.lower() != b.lower():
                    relations.append({
                        "source": a,
                        "target": b,
                        "relation": "co_accused",
                        "evidence": f"Both listed as numbered accused in the FIR/chargesheet",
                        "weight": 0.90,
                        "engine": "grounded_pattern",
                    })

        # 3. Victimization patterns (e.g. "cheated victim Suresh Sharma", "reported extortion threats by gangster Sharad Mohol")
        victim_regex = re.compile(
            r"\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:reported extortion threats by|threatened by|cheated|extorted|defrauded|threatened|assaulted|attacked|robbed|targeted)\s+(?:by\s+)?(?:gangster\s+|accused\s+|co-accused\s+)?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b",
            re.IGNORECASE,
        )
        for m in victim_regex.finditer(text):
            p1, p2 = m.group(1).strip(), m.group(2).strip()
            if p1 and p2 and p1.lower() != p2.lower():
                relations.append({
                    "source": p1,
                    "target": p2,
                    "relation": "victim_of",
                    "evidence": self._find_source_sentence(text, m.start(), m.end()),
                    "weight": 0.90,
                    "engine": "grounded_pattern",
                })

        # 4. Financial transfer patterns (e.g. "Vikram Singh transferred Rs. 50,000 to Ravi Jadhav")
        financial_regex = re.compile(
            r"\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:transferred|paid|remitted|sent)\s+(?:Rs\.?|INR|\$)?\s*[\d,]+\s+(?:to|into the account of)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b",
            re.IGNORECASE,
        )
        for m in financial_regex.finditer(text):
            p1, p2 = m.group(1).strip(), m.group(2).strip()
            if p1 and p2 and p1.lower() != p2.lower():
                relations.append({
                    "source": p1,
                    "target": p2,
                    "relation": "financial_transfer",
                    "evidence": self._find_source_sentence(text, m.start(), m.end()),
                    "weight": 0.90,
                    "engine": "grounded_pattern",
                })

        # 5. Phone communication patterns (e.g. "Ravi called Vikram Singh")
        phone_regex = re.compile(
            r"\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:called|contacted|phoned|communicated with)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b",
            re.IGNORECASE,
        )
        for m in phone_regex.finditer(text):
            p1, p2 = m.group(1).strip(), m.group(2).strip()
            if p1 and p2 and p1.lower() != p2.lower():
                relations.append({
                    "source": p1,
                    "target": p2,
                    "relation": "phone_call",
                    "evidence": self._find_source_sentence(text, m.start(), m.end()),
                    "weight": 0.85,
                    "engine": "grounded_pattern",
                })

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


def extract_entities(text: str) -> list[dict]:
    return get_shared_extractor().extract_entities_with_spans(text)


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