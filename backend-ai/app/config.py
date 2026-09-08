# ============================================================
# backend-ai/app/config.py
# CrimeNetX Configuration (Pydantic v2 Compatible)
# ============================================================

import os
from pathlib import Path
from typing import ClassVar
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App Settings
    APP_NAME: str = "CrimeNetX AI Backend"
    app_name: str = "CrimeNetX AI Backend"
    version: str = "1.0.0"
    DEBUG: bool = True
    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:5000",
]

    # --- STAGE 1: OCR SETTINGS ---
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

    # --- STAGE 2: TRANSLATION SETTINGS ---
    INDICTRANS_MODEL_SIZE: str = os.getenv("INDICTRANS_MODEL_SIZE", "200M")
    INDICTRANS_MODEL_NAME: str = (
        "ai4bharat/indictrans2-indic-en-dist-200M"
        if INDICTRANS_MODEL_SIZE == "200M"
        else "ai4bharat/indictrans2-indic-en-1B"
    )
    TRANSLATION_DEVICE: str = os.getenv("TRANSLATION_DEVICE", "auto")
    TRANSLATION_MAX_LENGTH: int = 256
    TRANSLATION_BATCH_SIZE: int = 8

   
    # STAGE 3: NER (GLiNER + spaCy fallback)
    # ========================
    # GLiNER model: "urchade/gliner_medium-v2.1" (best balance) 
    #   or "urchade/gliner_small-v2.1" (faster)
    #   or "urchade/gliner_large-v2.1" (most accurate)
    #   or "urchade/gliner_multi-v2.1" (Hindi/Marathi native support)
    GLINER_MODEL: str = os.getenv("GLINER_MODEL", "urchade/gliner_medium-v2.1")
    GLINER_THRESHOLD: float = 0.4   # Minimum confidence to accept an entity
    USE_GLINER: bool = True          # If False, falls back to spaCy
    
    SPACY_MODEL: str = os.getenv("SPACY_MODEL", "en_core_web_sm")

    # --- STAGE 4: ENTITY RESOLUTION (SPLINK) ---
    SPLINK_MATCH_THRESHOLD: float = 0.95
    SPLINK_REVIEW_THRESHOLD: float = 0.30

    # --- STAGE 5: GROQ / RELATIONSHIPS ---
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "qwen/qwen3.6-27b")

        # --- AI PROVIDER STATUS ---
    @property
    def groq_enabled(self) -> bool:
        return bool(self.GROQ_API_KEY)

    @property
    def gemini_enabled(self) -> bool:
        return bool(os.getenv("GEMINI_API_KEY", ""))

    # --- PROVENANCE & STORAGE ---
    RAW_TEXT_STORAGE_DIR: Path = Path(os.getenv("RAW_TEXT_DIR", "data/raw_texts"))
    PIPELINE_VERSION: str = "v2.1-ocr-indictrans-splink"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

# Export module-level variables for clean imports
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
SPLINK_MATCH_THRESHOLD = settings.SPLINK_MATCH_THRESHOLD
SPLINK_REVIEW_THRESHOLD = settings.SPLINK_REVIEW_THRESHOLD
GROQ_API_KEY = settings.GROQ_API_KEY
GROQ_MODEL = settings.GROQ_MODEL
GLINER_MODEL = settings.GLINER_MODEL
GLINER_THRESHOLD = settings.GLINER_THRESHOLD
USE_GLINER = settings.USE_GLINER
OCR_LANGUAGES = {
    "hindi": "hin",
    "marathi": "mar",
    "tamil": "tam",
    "telugu": "tel",
    "bengali": "ben",
    "gujarati": "guj",
    "kannada": "kan",
    "malayalam": "mal",
    "punjabi": "pan",
    "urdu": "urd",
    "english": "eng",
}