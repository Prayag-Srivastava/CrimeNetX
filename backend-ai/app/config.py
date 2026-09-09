"""
CrimeNetX AI service — application configuration.

Central configuration for:
- OCR / Tesseract
- IndicTrans2 translation
- GLiNER
- GLiNER-Relex
- spaCy fallback
- Splink
- Groq relation fallback
- Gemini vision
- ChromaDB
- Redis
- PostgreSQL
- Neo4j
- AWS/S3
"""

import os
from functools import lru_cache
from pathlib import Path
from typing import ClassVar

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # =========================================================================
    # Pydantic configuration
    # =========================================================================

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
    )

    # =========================================================================
    # Service / Application
    # =========================================================================

    APP_NAME: str = "CrimeNetX AI Backend"

    # Compatibility with existing code
    app_name: str = "CrimeNetX AI Backend"
    version: str = "1.0.0"

    DEBUG: bool = True

    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5000",
    ]

    # =========================================================================
    # Service URLs
    # =========================================================================

    # Docker Compose overrides this with:
    # http://backend-node:5000
    node_backend_url: str = "http://localhost:5000"

    # =========================================================================
    # Stage 1 — OCR / Tesseract
    # =========================================================================

    DEFAULT_TESS_PATH: ClassVar[str] = (
        r"C:\Program Files\Tesseract-OCR\tesseract.exe"
        if os.name == "nt"
        else "/usr/bin/tesseract"
    )

    TESSERACT_CMD: str = os.getenv(
        "TESSERACT_CMD",
        DEFAULT_TESS_PATH,
    )

    OCR_DEFAULT_LANG: str = "eng+hin"

    TESSERACT_PSM: int = 6
    TESSERACT_OEM: int = 3

    OCR_MIN_CONFIDENCE: int = 40
    PDF_DPI: int = 300

    OCR_LANGUAGES: dict[str, str] = Field(
        default_factory=lambda: {
            # Hindi
            "hi": "hin",
            "hindi": "hin",

            # Marathi
            "mr": "mar",
            "marathi": "mar",

            # Tamil
            "ta": "tam",
            "tamil": "tam",

            # Telugu
            "te": "tel",
            "telugu": "tel",

            # Bengali
            "bn": "ben",
            "bengali": "ben",

            # Gujarati
            "gu": "guj",
            "gujarati": "guj",

            # Kannada
            "kn": "kan",
            "kannada": "kan",

            # Malayalam
            "ml": "mal",
            "malayalam": "mal",

            # Punjabi
            "pa": "pan",
            "punjabi": "pan",

            # Urdu
            "ur": "urd",
            "urdu": "urd",

            # English
            "en": "eng",
            "english": "eng",
        }
    )

    # =========================================================================
    # Stage 2 — IndicTrans2 Translation
    # =========================================================================

    INDICTRANS_MODEL_SIZE: str = os.getenv(
        "INDICTRANS_MODEL_SIZE",
        "200M",
    )

    INDICTRANS_MODEL_NAME: str = (
        "ai4bharat/indictrans2-indic-en-dist-200M"
        if os.getenv("INDICTRANS_MODEL_SIZE", "200M") == "200M"
        else "ai4bharat/indictrans2-indic-en-1B"
    )

    TRANSLATION_DEVICE: str = os.getenv(
        "TRANSLATION_DEVICE",
        "auto",
    )

    TRANSLATION_MAX_LENGTH: int = 256
    TRANSLATION_BATCH_SIZE: int = 8

    # =========================================================================
    # Stage 3 — NER / Entity Extraction
    # =========================================================================

    # -------------------------------------------------------------------------
    # Plain GLiNER
    # -------------------------------------------------------------------------

    GLINER_MODEL: str = os.getenv(
        "GLINER_MODEL",
        "urchade/gliner_medium-v2.1",
    )

    GLINER_THRESHOLD: float = float(
        os.getenv("GLINER_THRESHOLD", "0.4")
    )

    USE_GLINER: bool = os.getenv(
        "USE_GLINER",
        "true",
    ).lower() in ("1", "true", "yes")

    # -------------------------------------------------------------------------
    # GLiNER-Relex — Joint NER + Relationship Extraction
    # -------------------------------------------------------------------------

    GLINER_RELEX_MODEL: str = os.getenv(
        "GLINER_RELEX_MODEL",
        "knowledgator/gliner-relex-large-v0.5",
    )

    USE_GLINER_RELEX: bool = os.getenv(
        "USE_GLINER_RELEX",
        "true",
    ).lower() in ("1", "true", "yes")

    RELEX_ENTITY_THRESHOLD: float = float(
        os.getenv("RELEX_ENTITY_THRESHOLD", "0.4")
    )

    # Important:
    # Above ~0.5 the adjacency gate can reject candidate pairs before
    # the relation head scores them.
    RELEX_ADJACENCY_THRESHOLD: float = float(
        os.getenv("RELEX_ADJACENCY_THRESHOLD", "0.35")
    )

    RELEX_RELATION_THRESHOLD: float = float(
        os.getenv("RELEX_RELATION_THRESHOLD", "0.75")
    )

    # -------------------------------------------------------------------------
    # spaCy fallback
    # -------------------------------------------------------------------------

    SPACY_MODEL: str = os.getenv(
        "SPACY_MODEL",
        "en_core_web_sm",
    )

    # =========================================================================
    # Stage 4 — Entity Resolution / Splink
    # =========================================================================

    SPLINK_MATCH_THRESHOLD: float = 0.95
    SPLINK_REVIEW_THRESHOLD: float = 0.30

    # =========================================================================
    # Stage 5 — Groq
    # =========================================================================

    # Groq is optional.
    # Current architecture uses it primarily as a relationship fallback.

    GROQ_API_KEY: str = os.getenv(
        "GROQ_API_KEY",
        "",
    )

    GROQ_MODEL: str = os.getenv(
        "GROQ_MODEL",
        "qwen/qwen3.6-27b",
    )

    # Compatibility aliases used by older code.
    groq_api_key: str = ""
    groq_model: str = "qwen/qwen3.6-27b"

    GROQ_RELATION_FALLBACK: bool = os.getenv(
        "GROQ_RELATION_FALLBACK",
        "false",
    ).lower() in ("1", "true", "yes")

    @property
    def groq_enabled(self) -> bool:
        return bool(
            self.GROQ_API_KEY
            or self.groq_api_key
        )

    # =========================================================================
    # Gemini — Multimodal / Vision
    # =========================================================================

    GEMINI_API_KEY: str = os.getenv(
        "GEMINI_API_KEY",
        "",
    )

    gemini_api_key: str = ""

    gemini_vision_model: str = os.getenv(
        "GEMINI_VISION_MODEL",
        "gemini-1.5-flash",
    )

    @property
    def gemini_enabled(self) -> bool:
        return bool(
            self.GEMINI_API_KEY
            or self.gemini_api_key
            or os.getenv("GEMINI_API_KEY", "")
        )

    # =========================================================================
    # Storage / Infrastructure
    # =========================================================================

    # Docker Compose overrides these values.

    chroma_persist_dir: str = os.getenv(
        "CHROMA_PERSIST_DIR",
        "./chroma_data",
    )

    redis_url: str = os.getenv(
        "REDIS_URL",
        "redis://localhost:6379",
    )

    database_url: str = os.getenv(
        "DATABASE_URL",
        "",
    )

    # =========================================================================
    # Neo4j
    # =========================================================================

    neo4j_uri: str = os.getenv(
        "NEO4J_URI",
        "bolt://localhost:7687",
    )

    neo4j_user: str = os.getenv(
        "NEO4J_USER",
        "neo4j",
    )

    neo4j_password: str = os.getenv(
        "NEO4J_PASSWORD",
        "crimenetx_neo4j_pass",
    )

    # =========================================================================
    # AWS / S3
    # =========================================================================

    aws_access_key_id: str = os.getenv(
        "AWS_ACCESS_KEY_ID",
        "",
    )

    aws_secret_access_key: str = os.getenv(
        "AWS_SECRET_ACCESS_KEY",
        "",
    )

    aws_region: str = os.getenv(
        "AWS_REGION",
        "ap-south-1",
    )

    aws_s3_bucket: str = os.getenv(
        "AWS_S3_BUCKET",
        "crimenetx-evidence",
    )

    # =========================================================================
    # Provenance / Pipeline
    # =========================================================================

    RAW_TEXT_STORAGE_DIR: Path = Path(
        os.getenv(
            "RAW_TEXT_DIR",
            "data/raw_texts",
        )
    )

    PIPELINE_VERSION: str = (
        "v2.2-ocr-indictrans-gliner-relex-splink"
    )

    @property
    def pipeline_version(self) -> str:
        return self.PIPELINE_VERSION


# =============================================================================
# Settings singleton
# =============================================================================

@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


# =============================================================================
# Module-level exports
# =============================================================================

PIPELINE_VERSION = settings.PIPELINE_VERSION
RAW_TEXT_STORAGE_DIR = settings.RAW_TEXT_STORAGE_DIR

# -----------------------------------------------------------------------------
# OCR
# -----------------------------------------------------------------------------

TESSERACT_CMD = settings.TESSERACT_CMD
OCR_DEFAULT_LANG = settings.OCR_DEFAULT_LANG
TESSERACT_PSM = settings.TESSERACT_PSM
TESSERACT_OEM = settings.TESSERACT_OEM
OCR_MIN_CONFIDENCE = settings.OCR_MIN_CONFIDENCE
PDF_DPI = settings.PDF_DPI
OCR_LANGUAGES = settings.OCR_LANGUAGES

# -----------------------------------------------------------------------------
# Translation
# -----------------------------------------------------------------------------

INDICTRANS_MODEL_NAME = settings.INDICTRANS_MODEL_NAME
TRANSLATION_DEVICE = settings.TRANSLATION_DEVICE
TRANSLATION_MAX_LENGTH = settings.TRANSLATION_MAX_LENGTH
TRANSLATION_BATCH_SIZE = settings.TRANSLATION_BATCH_SIZE

# -----------------------------------------------------------------------------
# spaCy
# -----------------------------------------------------------------------------

SPACY_MODEL = settings.SPACY_MODEL

# -----------------------------------------------------------------------------
# GLiNER
# -----------------------------------------------------------------------------

GLINER_MODEL = settings.GLINER_MODEL
GLINER_THRESHOLD = settings.GLINER_THRESHOLD
USE_GLINER = settings.USE_GLINER

# -----------------------------------------------------------------------------
# GLiNER-Relex
# -----------------------------------------------------------------------------

GLINER_RELEX_MODEL = settings.GLINER_RELEX_MODEL
USE_GLINER_RELEX = settings.USE_GLINER_RELEX
RELEX_ENTITY_THRESHOLD = settings.RELEX_ENTITY_THRESHOLD
RELEX_ADJACENCY_THRESHOLD = settings.RELEX_ADJACENCY_THRESHOLD
RELEX_RELATION_THRESHOLD = settings.RELEX_RELATION_THRESHOLD

# -----------------------------------------------------------------------------
# Splink
# -----------------------------------------------------------------------------

SPLINK_MATCH_THRESHOLD = settings.SPLINK_MATCH_THRESHOLD
SPLINK_REVIEW_THRESHOLD = settings.SPLINK_REVIEW_THRESHOLD

# -----------------------------------------------------------------------------
# Groq
# -----------------------------------------------------------------------------

GROQ_API_KEY = settings.GROQ_API_KEY or settings.groq_api_key
GROQ_MODEL = settings.GROQ_MODEL or settings.groq_model
GROQ_RELATION_FALLBACK = settings.GROQ_RELATION_FALLBACK