"""
CrimeNetX — 5-Stage Forensic NLP Pipeline Orchestrator
=======================================================
STAGE 1: Tesseract OCR (open source, local)
STAGE 2: IndicTrans2 Translation (open source, local)
STAGE 3: spaCy NER (open source, local)
STAGE 4: Splink Entity Resolution (open source, local)
STAGE 5: Groq LLM Relationships (KEPT AS-IS, cloud)

This is the SINGLE ENTRY POINT that the API router calls.
"""

import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from app.config import PIPELINE_VERSION
from app.utils.text_storage import TextStorage, compute_file_sha256, compute_sha256
from app.services.ocr_engine import OCREngine, OCRResult
from app.services.language_detector import LanguageDetector, DetectionResult
from app.services.translator import TranslatorService, TranslationResult
from app.services.entity_resolver import EntityResolver, ResolutionReport

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    """Complete output of the 5-stage pipeline."""
    document_id: str
    case_id: str
    success: bool

    # Stage 1: OCR
    ocr_text: str = ""
    ocr_language: str = ""
    ocr_confidence: float = 0.0
    ocr_warnings: list[str] = field(default_factory=list)

    # Stage 2: Translation
    translated_text: str = ""
    source_language: str = ""
    was_translated: bool = False
    translation_model: str = ""

    # Stage 3: NER
    entities: list[dict] = field(default_factory=list)

    # Stage 4: Entity Resolution
    resolution_report: Optional[ResolutionReport] = None

    # Stage 5: Relationships (still Groq)
    relationships: list[dict] = field(default_factory=list)

    # Provenance
    original_file_hash: str = ""
    ocr_text_hash: str = ""
    translated_text_hash: str = ""
    pipeline_version: str = PIPELINE_VERSION
    processing_time_seconds: float = 0.0
    stage_errors: list[str] = field(default_factory=list)


class ForensicPipeline:
    """
    Main pipeline orchestrator.

    Usage:
        pipeline = ForensicPipeline()
        result = pipeline.process_document(
            file_path="data/mock_firs/FIR_PUN_2024_0118.pdf",
            case_id="PUN-2024-0118",
            force_language="hi"  # Optional investigator language choice
        )
    """

    def __init__(self):
        self.ocr = OCREngine()
        self.detector = LanguageDetector()
        self.translator = TranslatorService()
        self.resolver = EntityResolver()
        self.storage = TextStorage()
        self._nlp_extractor = None

    def _get_nlp_extractor(self):
        """Lazy-load NLP extractor (spaCy NER + Groq relationships)."""
        if self._nlp_extractor is None:
            from app.services.nlp_extractor import NLPExtractor
            self._nlp_extractor = NLPExtractor()
        return self._nlp_extractor

    def process_document(
        self,
        file_path: str | Path,
        case_id: str,
        document_type: str = "FIR",
        existing_entities: Optional[list[dict]] = None,
        force_language: Optional[str] = None,
    ) -> PipelineResult:
        """Process a single document through all 5 stages."""
        start_time = time.time()
        document_id = f"{case_id}_{uuid.uuid4().hex[:8]}"
        file_path = Path(file_path)

        result = PipelineResult(
            document_id=document_id,
            case_id=case_id,
            success=False,
        )

        logger.info(f"=== Pipeline started: {file_path.name} (case: {case_id}) ===")

        # ---- Pre: Hash original file ----
        try:
            result.original_file_hash = compute_file_sha256(file_path)
        except Exception as e:
            result.stage_errors.append(f"File hashing failed: {e}")
            return result

        # ============================================================
        # STAGE 1: OCR
        # ============================================================
        logger.info("STAGE 1: OCR")
        try:
            ocr_lang = None
            if force_language:
                from app.config import OCR_LANGUAGES
                ocr_lang = OCR_LANGUAGES.get(force_language.lower(), "eng+hin")

            ocr_result = self.ocr.extract_from_pdf(file_path, lang=ocr_lang)

            if not ocr_result.success:
                result.stage_errors.append(f"OCR failed: {ocr_result.warnings}")
                return result

            result.ocr_text = ocr_result.text
            result.ocr_language = ocr_result.language
            result.ocr_confidence = ocr_result.confidence
            result.ocr_warnings = ocr_result.warnings
            logger.info(f"OCR: {len(result.ocr_text)} chars, {result.ocr_confidence}% conf")

        except Exception as e:
            result.stage_errors.append(f"Stage 1 error: {e}")
            return result

                # ============================================================
        # STAGE 2: LANGUAGE DETECTION + TRANSLATION
        # ============================================================
        logger.info("STAGE 2: Translation")
        try:
            if force_language:
                detection = self.detector.from_force_language(force_language)
            else:
                detection = self.detector.detect(result.ocr_text)

            result.source_language = detection.language
            logger.info(
                f"Language: iso={detection.language}, "
                f"tesseract={detection.tesseract_code}, "
                f"indictrans={detection.indictrans_code}, "
                f"method={detection.method}"
            )

            translation = self.translator.translate(
                result.ocr_text,
                source_lang=detection.language,
                source_indictrans_code=detection.indictrans_code,  # hin_Deva etc.
            )

            result.translated_text = translation.translated_text
            result.was_translated = translation.was_translated
            result.translation_model = translation.model_used

            if not translation.success:
                result.stage_errors.append(f"Translation fallback: {translation.error}")
                result.translated_text = result.ocr_text

            logger.info(
                f"Translation: was_translated={result.was_translated}, "
                f"src_tag={translation.source_indictrans_code}"
            )

        except Exception as e:
            result.stage_errors.append(f"Stage 2 error: {e}")
            result.translated_text = result.ocr_text
            result.source_language = "unknown"

        # ---- Store provenance ----
        try:
            result.ocr_text_hash = compute_sha256(result.ocr_text)
            result.translated_text_hash = compute_sha256(result.translated_text)

            self.storage.store_document(
                case_id=case_id,
                document_id=document_id,
                raw_ocr_text=result.ocr_text,
                translated_text=result.translated_text,
                ocr_language=result.ocr_language,
                ocr_confidence=result.ocr_confidence,
                source_language=result.source_language,
                original_filename=file_path.name,
                original_file_hash=result.original_file_hash,
                translation_model=result.translation_model,
            )
        except Exception as e:
            result.stage_errors.append(f"Storage error: {e}")

        # # ============================================================
        # # STAGE 3: NER (spaCy on translated English text)
        # # ============================================================
        # logger.info("STAGE 3: NER")
        # try:
        #     nlp = self._get_nlp_extractor()
        #     result.entities = nlp.extract_entities_with_spans(result.translated_text)
        #     logger.info(f"NER: {len(result.entities)} entities")
        # except Exception as e:
        #     result.stage_errors.append(f"Stage 3 error: {e}")
        #     result.entities = []
        logger.info("STAGE 3+5: Joint IE (GLiNER-relex)")
        try:
            nlp = self._get_nlp_extractor()
            if hasattr(nlp, "extract_entities_and_relations"):
                result.entities, result.relationships = nlp.extract_entities_and_relations(
                    result.translated_text
                )
            else:
                result.entities = nlp.extract_entities_with_spans(result.translated_text)
                result.relationships = nlp.extract_relationships(
                    result.translated_text,
                    [e["text"] for e in result.entities if e["label"] == "PERSON"],
                )
            logger.info(
                f"IE: {len(result.entities)} ents, {len(result.relationships)} rels "
                f"({getattr(nlp, '_extraction_engine', '?')})"
            )
        except Exception as e:
            result.stage_errors.append(f"Stage 3/5 error: {e}")
            result.entities, result.relationships = [], []

        # then STAGE 4 Splink on PERSON entities (unchanged)
        # ============================================================
        # STAGE 4: ENTITY RESOLUTION (Splink)
        # ============================================================
        logger.info("STAGE 4: Entity Resolution")
        try:
            person_entities = [
                {
                    "id": f"ent_{i}",
                    "full_name": ent["text"],
                    "first_name": ent["text"].split()[0] if ent["text"].split() else "",
                    "last_name": ent["text"].split()[-1] if len(ent["text"].split()) > 1 else "",
                    "phone": "",
                    "father_name": "",
                }
                for i, ent in enumerate(result.entities)
                if ent["label"] == "PERSON"
            ]

            if person_entities:
                result.resolution_report = self.resolver.resolve_entities(
                    new_entities=person_entities,
                    existing_entities=existing_entities or [],
                )
                logger.info(
                    f"Resolution: {result.resolution_report.merges} merges, "
                    f"{result.resolution_report.reviews} reviews"
                )
        except Exception as e:
            result.stage_errors.append(f"Stage 4 error: {e}")

        # # ============================================================
        # # STAGE 5: RELATIONSHIPS (Groq — KEPT AS-IS)
        # # ============================================================
        # logger.info("STAGE 5: Relationships (Groq)")
        # try:
        #     nlp = self._get_nlp_extractor()
        #     result.relationships = nlp.extract_relationships(
        #         result.translated_text,
        #         known_entities=[e["text"] for e in result.entities if e["label"] == "PERSON"],
        #     )
        #     logger.info(f"Relationships: {len(result.relationships)} found")
        # except Exception as e:
        #     result.stage_errors.append(f"Stage 5 error: {e}")
        #     result.relationships = []

        # # ---- Finalize ----
        # result.processing_time_seconds = round(time.time() - start_time, 2)
        # result.success = len(result.stage_errors) == 0 or len(result.entities) > 0

        # logger.info(
        #     f"=== Pipeline complete in {result.processing_time_seconds}s | "
        #     f"success={result.success} | entities={len(result.entities)} | "
        #     f"relations={len(result.relationships)} | errors={len(result.stage_errors)} ==="
        # )

        

        return result