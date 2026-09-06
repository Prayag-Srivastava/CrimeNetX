"""
CrimeNetX — NLP Extractor (Modified for Pipeline v2.1)
=======================================================
CHANGES:
  - NEW: extract_entities_with_spans() → spaCy NER with character offsets
  - KEPT: extract_relationships() → Groq LLM (unchanged)
  - KEPT: _cooccurrence_relations() → Fallback (unchanged)
  - KEPT: extract_from_cdr() → Direct CDR parsing (unchanged)
  - KEPT: extract_from_bank() → Direct Bank parsing (unchanged)

The old extract() method is preserved for backward compatibility
but the new pipeline.py calls the individual stage methods instead.
"""

import logging
import re
from typing import Optional

import spacy
from pydantic import BaseModel
from app.models.schemas import Entity, EntityExtractionResponse, EntityType

from app.config import SPACY_MODEL, GROQ_API_KEY

logger = logging.getLogger(__name__)


# ---- Pydantic schemas for Groq (KEPT AS-IS) ----
class LlmRelation(BaseModel):
    source: str
    target: str
    relation: str   # family | associate | same_organization | phone_call | financial_transfer
    evidence: str


class LlmExtraction(BaseModel):
    relations: list[LlmRelation]


class NLPExtractor:
    """
    NLP Extractor with spaCy NER + Groq relationships.

    NEW pipeline calls:
        nlp.extract_entities_with_spans(text)    → spaCy only
        nlp.extract_relationships(text, entities) → Groq

    OLD pipeline calls (still work):
        nlp.extract(text)                        → Groq does everything
        nlp.extract_from_cdr(csv_path)            → Direct parsing
        nlp.extract_from_bank(csv_path)           → Direct parsing
    """

    def __init__(self):
        # Load spaCy model
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

        # Custom regex patterns for Indian entities
        self._phone_pattern = re.compile(
            r'(?:(?:\+91|0)?[\s\-]?)?(?:\d{5}[\s\-]?\d{5}|\d{10})'
        )
        self._imei_pattern = re.compile(r'\b\d{15}\b')
        self._vehicle_pattern = re.compile(
            r'\b[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{1,4}\b', re.IGNORECASE
        )
        self._law_pattern = re.compile(
            r'(?:BNS|IPC|CrPC|BNSS|IT Act|NDPS|POCSO)\s*(?:§|Section|Sec\.?)\s*\d+[A-Z]?',
            re.IGNORECASE
        )
        self._pincode_pattern = re.compile(r'\b[1-9]\d{5}\b')
        self._bank_account_pattern = re.compile(r'\b\d{9,18}\b')

    # ================================================================
    # NEW: spaCy NER with source spans (Stage 3 of pipeline)
    # ================================================================
    def extract_entities_with_spans(self, text: str) -> list[dict]:
        """
        Extract entities using spaCy with character-level offsets.
        This is the NEW method called by pipeline.py Stage 3.

        Returns:
            [
                {
                    "text": "Ravi Jadhav",
                    "label": "PERSON",
                    "start": 42,
                    "end": 55,
                    "source_sentence": "The accused Ravi Jadhav was seen at...",
                    "page": 1,
                },
                ...
            ]
        """
        if not self.nlp or not text:
            return []

        entities = []
        doc = self.nlp(text)

        # Process spaCy's built-in entities
        for ent in doc.ents:
            # Find the sentence containing this entity
            sentence = next(
                (sent.text.strip() for sent in doc.sents
                 if sent.start_char <= ent.start_char and sent.end_char >= ent.end_char),
                ""
            )

            entities.append({
                "text": ent.text.strip(),
                "label": ent.label_,
                "start": ent.start_char,
                "end": ent.end_char,
                "source_sentence": sentence[:200],  # Truncate long sentences
                "page": 1,  # TODO: Calculate from OCR page breaks
            })

        # Add custom regex-based entities
        entities.extend(self._extract_custom_entities(text, doc))

        # Deduplicate overlapping entities
        entities = self._deduplicate_entities(entities)

        logger.info(
            f"spaCy NER: {len(entities)} entities "
            f"({sum(1 for e in entities if e['label'] == 'PERSON')} persons, "
            f"{sum(1 for e in entities if e['label'] == 'GPE')} locations, "
            f"{sum(1 for e in entities if e['label'] == 'ORG')} orgs)"
        )

        return entities

    def _extract_custom_entities(self, text: str, doc) -> list[dict]:
        """Extract Indian-specific entities using regex patterns."""
        custom_entities = []

        patterns = [
            ("PHONE", self._phone_pattern),
            ("IMEI", self._imei_pattern),
            ("VEHICLE", self._vehicle_pattern),
            ("LAW_SECTION", self._law_pattern),
            ("PINCODE", self._pincode_pattern),
        ]

        for label, pattern in patterns:
            for match in pattern.finditer(text):
                matched_text = match.group().strip()
                if len(matched_text) < 4:
                    continue

                # Find containing sentence
                sentence = ""
                for sent in doc.sents:
                    if sent.start_char <= match.start() and sent.end_char >= match.end():
                        sentence = sent.text.strip()[:200]
                        break

                custom_entities.append({
                    "text": matched_text,
                    "label": label,
                    "start": match.start(),
                    "end": match.end(),
                    "source_sentence": sentence,
                    "page": 1,
                })

        return custom_entities

    def _deduplicate_entities(self, entities: list[dict]) -> list[dict]:
        """Remove overlapping entities, keeping the longest span."""
        if not entities:
            return []

        # Sort by start position, then by length (longest first)
        entities.sort(key=lambda e: (e["start"], -(e["end"] - e["start"])))

        deduped = []
        last_end = -1

        for ent in entities:
            if ent["start"] >= last_end:
                deduped.append(ent)
                last_end = ent["end"]
            else:
                # Overlapping — keep the longer one
                if (ent["end"] - ent["start"]) > (deduped[-1]["end"] - deduped[-1]["start"]):
                    deduped[-1] = ent
                    last_end = ent["end"]

        return deduped

    # ================================================================
    # KEPT AS-IS: Groq relationship extraction (Stage 5 of pipeline)
    # ================================================================
    def extract_relationships(
        self,
        text: str,
        known_entities: Optional[list[str]] = None,
    ) -> list[dict]:
        """
        Extract relationships using Groq LLM.
        THIS IS UNCHANGED from your original code.
        Groq still handles relationship extraction.
        """
        if not text or len(text.strip()) < 50:
            return []

        # Try Groq first
        try:
            relations = self._llm_layer(text, known_entities)
            if relations:
                return relations
        except Exception as e:
            logger.warning(f"Groq relationship extraction failed: {e}")

        # Fallback to co-occurrence
        logger.info("Falling back to co-occurrence relationships")
        return self._cooccurrence_relations(text)

    def _llm_layer(
        self,
        text: str,
        known_entities: Optional[list[str]] = None,
    ) -> list[dict]:
        """
        Groq LLM relationship extraction.
        KEPT EXACTLY AS YOUR ORIGINAL CODE.
        """
        if not GROQ_API_KEY:
            logger.warning("No GROQ_API_KEY set, skipping LLM layer")
            return []

        try:
            from groq import Groq
            client = Groq(api_key=GROQ_API_KEY)

            entity_hint = ""
            if known_entities:
                entity_hint = f"\nKnown entities in this text: {', '.join(known_entities[:20])}"

            prompt = f"""Extract all relationships between people mentioned in this FIR text.

For each relationship, provide:
- source: name of first person
- target: name of second person
- relation: one of [family, associate, same_organization, phone_call, financial_transfer]
- evidence: the EXACT sentence from the text that proves this relationship
{entity_hint}

FIR Text:
{text[:4000]}

Respond with JSON: {{"relations": [{{"source": "...", "target": "...", "relation": "...", "evidence": "..."}}]}}"""

            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "system", "content": "You are a crime intelligence analyst. Extract relationships from FIR text. Respond only with valid JSON."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )

            import json
            parsed = json.loads(response.choices[0].message.content)
            extraction = LlmExtraction.model_validate(parsed)

            return [
                {
                    "source": r.source,
                    "target": r.target,
                    "relation": r.relation,
                    "evidence": r.evidence,
                }
                for r in extraction.relations
            ]

        except Exception as e:
            logger.error(f"LLM layer error: {e}")
            return []

    def _cooccurrence_relations(self, text: str) -> list[dict]:
        """
        Fallback: paragraph co-occurrence.
        KEPT EXACTLY AS YOUR ORIGINAL CODE.
        """
        if not self.nlp:
            return []

        doc = self.nlp(text)
        paragraphs = text.split("\n\n")
        relations = []
        seen_pairs = set()

        for para in paragraphs:
            if len(para.strip()) < 30:
                continue
            para_doc = self.nlp(para)
            persons = list(set(ent.text.strip() for ent in para_doc.ents if ent.label_ == "PERSON"))

            for i in range(len(persons)):
                for j in range(i + 1, len(persons)):
                    pair = tuple(sorted([persons[i], persons[j]]))
                    if pair not in seen_pairs:
                        seen_pairs.add(pair)
                        relations.append({
                            "source": pair[0],
                            "target": pair[1],
                            "relation": "associate",
                            "evidence": f"Co-mentioned in FIR paragraph: {para[:100]}...",
                        })

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
                        "evidence": f"CDR row {idx + 1} @ {row.get('timestamp', row.get('date', 'unknown'))} (Duration: {row.get('duration', 'N/A')}s)",
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
                        "evidence": f"{amount} INR @ {row.get('timestamp', row.get('date', 'unknown'))}",
                    })
        except Exception as e:
            logger.error(f"Bank parsing failed: {e}")
        return relations

# ================================================================
# Backward-compatible module-level entity extraction
# Used by entity_agent.py and supervisor_agent.py
# ================================================================

def extract_entities(
    text: str,
    source_name: str = "agent",
    case_id: Optional[str] = None,
) -> EntityExtractionResponse:
    """
    Compatibility wrapper for the agentic pipeline.

    Uses the NLPExtractor's spaCy/regex entity extraction and
    Groq relationship extraction.
    """
    extractor = NLPExtractor()

    # Stage 1: spaCy + regex entity extraction
    raw_entities = extractor.extract_entities_with_spans(text)

    entities = []

    for item in raw_entities:
        label = item.get("label", "")
        value = item.get("text", "")

        # Map spaCy/custom labels to our EntityType enum
        label_map = {
            "PERSON": EntityType.PERSON,
            "PER": EntityType.PERSON,
            "GPE": EntityType.LOCATION,
            "LOC": EntityType.LOCATION,
            "LOCATION": EntityType.LOCATION,
            "ORG": EntityType.ORGANIZATION,
            "ORGANIZATION": EntityType.ORGANIZATION,
            "PHONE": EntityType.PHONE,
            "VEHICLE": EntityType.VEHICLE,
            "BANK_ACCOUNT": EntityType.BANK_ACCOUNT,
            "DATE": EntityType.DATE,
            "ALIAS": EntityType.ALIAS,
            "CRYPTO_WALLET": EntityType.CRYPTO_WALLET,
        }

        entity_type = label_map.get(label.upper())

        # Ignore unsupported labels rather than crashing
        if entity_type is None:
            continue

        entities.append(
            Entity(
                id=None,
                type=entity_type,
                value=value,
                confidence=0.8,
                extracted_from=source_name,
                layer="spacy" if label.upper() in {
                    "PERSON",
                    "PER",
                    "GPE",
                    "LOC",
                    "LOCATION",
                    "ORG",
                    "ORGANIZATION",
                    "DATE",
                } else "regex",
                attributes={
                    "start": item.get("start"),
                    "end": item.get("end"),
                    "source_sentence": item.get("source_sentence", ""),
                    "page": item.get("page", 1),
                    **({"case_id": case_id} if case_id else {}),
                },
            )
        )

    # Stage 2: relationship extraction
    known_entity_names = [entity.value for entity in entities]

    relations = extractor.extract_relationships(
        text,
        known_entities=known_entity_names,
    )

    return EntityExtractionResponse(
        entities=entities,
        relations=relations,
        llm_used=bool(relations),
        warnings=[],
    )

    