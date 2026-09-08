"""CrimeNetX AI service — application configuration.

All secrets come from environment variables. Missing keys degrade gracefully:
LLM-dependent features return deterministic rule-based fallbacks so the
platform remains demonstrable without paid API keys.
"""

from functools import lru_cache
import os
from pathlib import Path
from typing import ClassVar

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
    )

    # -----------------------------------------------------------------------
    # Service / Application
    # -----------------------------------------------------------------------

    APP_NAME: str = "CrimeNetX AI Backend"
    app_name: str = "CrimeNetX AI Service"
    version: str = "1.0.0"
    DEBUG: bool = True

    node_backend_url: str = "http://localhost:5000"

    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5000",
    ]

    # -----------------------------------------------------------------------
    # LLM — Groq is primary for text / reasoning
    # -----------------------------------------------------------------------

    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "qwen/qwen3.6-27b"

    # Compatibility aliases used by existing AI code.
    groq_api_key: str = ""
    groq_model: str = "qwen/qwen3.6-27b"

    @property
    def groq_enabled(self) -> bool:
        return bool(self.GROQ_API_KEY or self.groq_api_key)

    # -----------------------------------------------------------------------
    # Gemini — multimodal vision
    # -----------------------------------------------------------------------

    GEMINI_API_KEY: str = ""
    gemini_api_key: str = ""
    gemini_vision_model: str = "gemini-1.5-flash"

    @property
    def gemini_enabled(self) -> bool:
        return bool(
            self.GEMINI_API_KEY
            or self.gemini_api_key
            or os.getenv("GEMINI_API_KEY", "")
        )

    # -----------------------------------------------------------------------
    # Storage / Infrastructure
    # -----------------------------------------------------------------------

    chroma_persist_dir: str = "./chroma_data"
    redis_url: str = "redis://localhost:6379"
    database_url: str = ""

    # Neo4j configuration.
    # Neo4j is now the graph database/backend; these settings are retained
    # here for the Neo4j service implementation.
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "crimenetx_neo4j_pass"

    # AWS / S3
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "ap-south-1"
    aws_s3_bucket: str = "crimenetx-evidence"

    # -----------------------------------------------------------------------
    # Stage 1 — OCR / Tesseract
    # -----------------------------------------------------------------------

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

    # Supported OCR language mappings.
    OCR_LANGUAGES: dict[str, str] = Field(
        default_factory=lambda: {
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
    )

    # -----------------------------------------------------------------------
    # Stage 2 — IndicTrans2 translation
    # -----------------------------------------------------------------------

    INDICTRANS_MODEL_SIZE: str = os.getenv(
        "INDICTRANS_MODEL_SIZE",
        "200M",
    )

    INDICTRANS_MODEL_NAME: str = (
        "ai4bharat/indictrans2-indic-en-dist-200M"
        if INDICTRANS_MODEL_SIZE == "200M"
        else "ai4bharat/indictrans2-indic-en-1B"
    )

    TRANSLATION_DEVICE: str = os.getenv(
        "TRANSLATION_DEVICE",
        "auto",
    )

    TRANSLATION_MAX_LENGTH: int = 256
    TRANSLATION_BATCH_SIZE: int = 8

    # -----------------------------------------------------------------------
    # Stage 3 — NER / spaCy
    # -----------------------------------------------------------------------

    SPACY_MODEL: str = os.getenv(
        "SPACY_MODEL",
        "en_core_web_sm",
    )

    # -----------------------------------------------------------------------
    # Stage 4 — Entity Resolution / Splink
    # -----------------------------------------------------------------------

    SPLINK_MATCH_THRESHOLD: float = 0.95
    SPLINK_REVIEW_THRESHOLD: float = 0.30

    # -----------------------------------------------------------------------
    # Stage 5 — Relationship extraction
    # -----------------------------------------------------------------------

    # -----------------------------------------------------------------------
    # Provenance / pipeline
    # -----------------------------------------------------------------------

    RAW_TEXT_STORAGE_DIR: Path = Path(
        os.getenv(
            "RAW_TEXT_DIR",
            "data/raw_texts",
        )
    )

    PIPELINE_VERSION: str = "v2.1-ocr-indictrans-splink"

    # -----------------------------------------------------------------------
    # Backwards-compatible module/service aliases
    # -----------------------------------------------------------------------

    @property
    def pipeline_version(self) -> str:
        return self.PIPELINE_VERSION


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


# ===========================================================================
# Module-level exports
# ===========================================================================

PIPELINE_VERSION = settings.PIPELINE_VERSION
RAW_TEXT_STORAGE_DIR = settings.RAW_TEXT_STORAGE_DIR

TESSERACT_CMD = settings.TESSERACT_CMD
OCR_DEFAULT_LANG = settings.OCR_DEFAULT_LANG
TESSERACT_PSM = settings.TESSERACT_PSM
TESSERACT_OEM = settings.TESSERACT_OEM
OCR_MIN_CONFIDENCE = settings.OCR_MIN_CONFIDENCE
PDF_DPI = settings.PDF_DPI
OCR_LANGUAGES = settings.OCR_LANGUAGES

INDICTRANS_MODEL_NAME = settings.INDICTRANS_MODEL_NAME
TRANSLATION_DEVICE = settings.TRANSLATION_DEVICE
TRANSLATION_MAX_LENGTH = settings.TRANSLATION_MAX_LENGTH
TRANSLATION_BATCH_SIZE = settings.TRANSLATION_BATCH_SIZE

SPACY_MODEL = settings.SPACY_MODEL

SPLINK_MATCH_THRESHOLD = settings.SPLINK_MATCH_THRESHOLD
SPLINK_REVIEW_THRESHOLD = settings.SPLINK_REVIEW_THRESHOLD

GROQ_API_KEY = settings.GROQ_API_KEY or settings.groq_api_key
GROQ_MODEL = settings.GROQ_MODEL or settings.groq_model