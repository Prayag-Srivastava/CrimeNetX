# ============================================================
# backend-ai/app/config.py
# CrimeNetX Configuration (Pydantic v2 Compatible)
# ============================================================

import os
from pathlib import Path
from typing import ClassVar

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    APP_NAME: str = "CrimeNetX AI Backend"
    app_name: str = "CrimeNetX AI Backend"
    version: str = "1.0.0"
    DEBUG: bool = True
    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:5000",
    ]

    # --- STAGE 1: OCR ---
    DEFAULT_TESS_PATH: ClassVar[str] = (
        r"C:\Program Files\Tesseract-OCR\tesseract.exe"
        if os.name == "nt"
        else "/usr/bin/tesseract"
    )
    TESSERACT_CMD: str = os.getenv("TESSERACT_CMD", DEFAULT_TESS_PATH)
    OCR_DEFAULT_LANG: str = "eng+hin"
    TESSERACT_PSM: int = 6
    TESSERACT_OEM: int = 3
    OCR_MIN_CONFIDENCE: int = 40
    PDF_DPI: int = 300

    # --- STAGE 2: TRANSLATION ---
    INDICTRANS_MODEL_SIZE: str = os.getenv("INDICTRANS_MODEL_SIZE", "200M")
    INDICTRANS_MODEL_NAME: str = (
        "ai4bharat/indictrans2-indic-en-dist-200M"
        if os.getenv("INDICTRANS_MODEL_SIZE", "200M") == "200M"
        else "ai4bharat/indictrans2-indic-en-1B"
    )
    TRANSLATION_DEVICE: str = os.getenv("TRANSLATION_DEVICE", "auto")
    TRANSLATION_MAX_LENGTH: int = 256
    TRANSLATION_BATCH_SIZE: int = 8

    # --- STAGE 3: NER ---
    # Plain GLiNER (entity-only fallback if relex fails)
    GLINER_MODEL: str = os.getenv("GLINER_MODEL", "urchade/gliner_medium-v2.1")
    GLINER_THRESHOLD: float = float(os.getenv("GLINER_THRESHOLD", "0.4"))
    USE_GLINER: bool = os.getenv("USE_GLINER", "true").lower() in ("1", "true", "yes")

    # Joint NER + RE (primary)
    GLINER_RELEX_MODEL: str = os.getenv(
        "GLINER_RELEX_MODEL",
        "knowledgator/gliner-relex-large-v0.5",
    )
    USE_GLINER_RELEX: bool = os.getenv("USE_GLINER_RELEX", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    RELEX_ENTITY_THRESHOLD: float = float(os.getenv("RELEX_ENTITY_THRESHOLD", "0.4"))
    RELEX_ADJACENCY_THRESHOLD: float = float(
        os.getenv("RELEX_ADJACENCY_THRESHOLD", "0.55")
    )
    RELEX_RELATION_THRESHOLD: float = float(
        os.getenv("RELEX_RELATION_THRESHOLD", "0.75")
    )

    # spaCy last-resort fallback
    SPACY_MODEL: str = os.getenv("SPACY_MODEL", "en_core_web_sm")

    # --- STAGE 4: SPLINK ---
    SPLINK_MATCH_THRESHOLD: float = 0.95
    SPLINK_REVIEW_THRESHOLD: float = 0.30

    # --- STAGE 5: Groq (optional relation fallback only) ---
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    GROQ_RELATION_FALLBACK: bool = os.getenv(
        "GROQ_RELATION_FALLBACK", "false"
    ).lower() in ("1", "true", "yes")

    # --- Provenance ---
    RAW_TEXT_STORAGE_DIR: Path = Path(os.getenv("RAW_TEXT_DIR", "data/raw_texts"))
    PIPELINE_VERSION: str = "v2.2-ocr-indictrans-gliner-relex-splink"

    @property
    def groq_enabled(self) -> bool:
        return bool(self.GROQ_API_KEY)

    @property
    def gemini_enabled(self) -> bool:
        return bool(os.getenv("GEMINI_API_KEY", ""))

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

# ---------------------------------------------------------------------------
# Module-level exports (single source of truth = settings)
# ---------------------------------------------------------------------------
PIPELINE_VERSION = settings.PIPELINE_VERSION
RAW_TEXT_STORAGE_DIR = settings.RAW_TEXT_STORAGE_DIR

TESSERACT_CMD = settings.TESSERACT_CMD
OCR_DEFAULT_LANG = settings.OCR_DEFAULT_LANG
TESSERACT_PSM = settings.TESSERACT_PSM
TESSERACT_OEM = settings.TESSERACT_OEM
OCR_MIN_CONFIDENCE = settings.OCR_MIN_CONFIDENCE
PDF_DPI = settings.PDF_DPI

INDICTRANS_MODEL_NAME = settings.INDICTRANS_MODEL_NAME
TRANSLATION_DEVICE = settings.TRANSLATION_DEVICE
TRANSLATION_MAX_LENGTH = settings.TRANSLATION_MAX_LENGTH
TRANSLATION_BATCH_SIZE = settings.TRANSLATION_BATCH_SIZE

SPACY_MODEL = settings.SPACY_MODEL

GLINER_MODEL = settings.GLINER_MODEL
GLINER_THRESHOLD = settings.GLINER_THRESHOLD
USE_GLINER = settings.USE_GLINER

GLINER_RELEX_MODEL = settings.GLINER_RELEX_MODEL
USE_GLINER_RELEX = settings.USE_GLINER_RELEX
RELEX_ENTITY_THRESHOLD = settings.RELEX_ENTITY_THRESHOLD
RELEX_ADJACENCY_THRESHOLD = settings.RELEX_ADJACENCY_THRESHOLD
RELEX_RELATION_THRESHOLD = settings.RELEX_RELATION_THRESHOLD
GROQ_RELATION_FALLBACK = settings.GROQ_RELATION_FALLBACK

SPLINK_MATCH_THRESHOLD = settings.SPLINK_MATCH_THRESHOLD
SPLINK_REVIEW_THRESHOLD = settings.SPLINK_REVIEW_THRESHOLD

GROQ_API_KEY = settings.GROQ_API_KEY
GROQ_MODEL = settings.GROQ_MODEL

OCR_LANGUAGES = {
    "hi": "hin",
    "hindi": "hin",
    "mr": "mar",
    "marathi": "mar",
    "ta": "tam",
    "tamil": "tam",
    "te": "tel",
    "telugu": "tel",
    "bn": "ben",
    "bengali": "ben",
    "gu": "guj",
    "gujarati": "guj",
    "kn": "kan",
    "kannada": "kan",
    "ml": "mal",
    "malayalam": "mal",
    "pa": "pan",
    "punjabi": "pan",
    "ur": "urd",
    "urdu": "urd",
    "en": "eng",
    "english": "eng",
}