"""
Pydantic schemas for the 5-stage pipeline.
"""
from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum
from datetime import datetime



# ── ENUMS ──────────────────────────────────────────────────

class OCRStatus(str, Enum):
    PENDING = "PENDING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class TranslationStatus(str, Enum):
    PENDING = "PENDING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    SKIPPED_NOT_NEEDED = "SKIPPED_NOT_NEEDED"


class TimelineState(str, Enum):
    RECORDED = "RECORDED"
    DELAYED = "DELAYED"
    IMPOSSIBLE = "IMPOSSIBLE"
    ABSENT = "ABSENT"


# ── STAGE 1: OCR OUTPUT ───────────────────────────────────

class OcrPageResult(BaseModel):
    page_number: int
    text: str
    confidence: float = Field(ge=0, le=100)
    language: str


class OcrResult(BaseModel):
    full_text: str
    pages: list[OcrPageResult]
    detected_language: str
    average_confidence: float
    status: OCRStatus
    error_message: Optional[str] = None
    raw_text_hash: str  # SHA-256 of full_text


# ── STAGE 2: TRANSLATION OUTPUT ───────────────────────────

class TranslationResult(BaseModel):
    translated_text: str
    source_language: str
    target_language: str = "en"
    model_used: str
    status: TranslationStatus
    error_message: Optional[str] = None
    translated_text_hash: str  # SHA-256


# ── STAGE 3: NER OUTPUT ───────────────────────────────────

class EntitySpan(BaseModel):
    text: str
    label: str           # PERSON, ORG, GPE, DATE, PHONE, VEHICLE, MONEY, LAW
    start_char: int      # Character offset in source text
    end_char: int
    confidence: float
    source_sentence: str  # The full sentence containing this entity


class NerResult(BaseModel):
    entities: list[EntitySpan]
    model_used: str
    total_entities: int
    text_hash: str  # SHA-256 of input text


# ── STAGE 4: ENTITY RESOLUTION OUTPUT ─────────────────────

class FieldScore(BaseModel):
    field_name: str
    score: float
    comparison_type: str  # "jaro_winkler" | "exact" | "phonetic" | "jaccard"


class ResolutionMatch(BaseModel):
    source_entity: str
    target_entity: str
    target_node_id: Optional[str] = None
    match_weight: float
    match_probability: float
    decision: str  # "MERGE" | "SPLIT" | "REVIEW"
    field_scores: list[FieldScore]
    blocking_key: Optional[str] = None


class ResolutionResult(BaseModel):
    matches: list[ResolutionMatch]
    new_entities: list[str]       # Entities that didn't match anyone
    merged_entities: list[str]    # Entities that were merged
    review_needed: list[str]      # Entities needing human review
    total_comparisons: int


# ── STAGE 5: RELATIONSHIP OUTPUT ──────────────────────────

class LlmRelation(BaseModel):
    source: str
    target: str
    relation: str
    evidence: str


class RelationshipResult(BaseModel):
    relations: list[LlmRelation]
    mechanism: str  # "GROQ_LLM" | "COOCCURRENCE" | "CDR_DIRECT" | "BANK_DIRECT"


# ── FULL PIPELINE OUTPUT ──────────────────────────────────

class PipelineStageTiming(BaseModel):
    stage: str
    duration_seconds: float
    status: str


class PipelineResult(BaseModel):
    document_id: Optional[str] = None
    case_id: str
    filename: str

    # Stage outputs
    ocr: Optional[OcrResult] = None
    translation: Optional[TranslationResult] = None
    ner: Optional[NerResult] = None
    resolution: Optional[ResolutionResult] = None
    relationships: Optional[RelationshipResult] = None

    # Provenance chain
    ingestion_hash: str
    pipeline_version: str
    timeline_state: TimelineState = TimelineState.RECORDED

    # Performance
    total_duration_seconds: float
    stage_timings: list[PipelineStageTiming]

    # Quality flags
    quality_warnings: list[str] = []


# ── API REQUEST/RESPONSE ──────────────────────────────────

class ProcessDocumentRequest(BaseModel):
    case_id: str
    document_type: str = "FIR"


class ProvenanceResponse(BaseModel):
    document_id: str
    ingestion_hash: str
    raw_ocr_hash: Optional[str]
    translated_hash: Optional[str]
    source_language: Optional[str]
    ocr_confidence: Optional[float]
    timeline_state: str
    admissibility: str
    pipeline_version: str
    processed_at: Optional[datetime]
    # ============================================================
# ADD THESE TO YOUR EXISTING schemas.py
# ============================================================



class OCREntity(BaseModel):
    """Entity extracted by spaCy with source span."""
    text: str
    label: str                    # PERSON, ORG, GPE, PHONE, VEHICLE, LAW_SECTION
    start: int                    # Character offset start
    end: int                      # Character offset end
    source_sentence: str = ""     # The sentence containing this entity
    page: int = 1


class PipelineStageStatus(BaseModel):
    """Status of a single pipeline stage."""
    stage: str                    # "ocr" | "translation" | "ner" | "resolution" | "relationships"
    success: bool
    error: Optional[str] = None
    duration_seconds: float = 0.0


class PipelineResponse(BaseModel):
    """API response for the forensic pipeline."""
    document_id: str
    case_id: str
    success: bool

    # Provenance
    original_file_hash: str
    ocr_text_hash: str
    translated_text_hash: str
    pipeline_version: str

    # Results
    ocr_confidence: float
    source_language: str
    was_translated: bool
    entities: list[OCREntity] = []
    relationships: list[dict] = []

    # Resolution summary
    entities_merged: int = 0
    entities_flagged_for_review: int = 0

    # Metadata
    processing_time_seconds: float
    stage_errors: list[str] = []


class ProvenanceResponse(BaseModel):
    """Court-ready provenance chain for a document."""
    document_id: str
    case_id: str
    hash_chain: dict              # step_1 → step_2 → step_3
    ocr_language: str
    ocr_confidence: float
    translation_model: str
    source_language: str
    pipeline_version: str
    ingested_at: str
    raw_text_available: bool
    translated_text_available: bool


class IntegrityCheckResponse(BaseModel):
    """Result of tamper verification."""
    document_id: str
    is_valid: bool
    checks: list[dict]            # Per-stage hash comparisons
    error: Optional[str] = None