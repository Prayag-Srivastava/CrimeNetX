"""
CrimeNetX AI Service — Unified Pydantic Schemas

Combines:
- Existing CrimeNetX NLP / graph / financial / vision schemas
- v2 OCR / translation / entity-resolution pipeline
- Document provenance
- Investigator chatbot schemas
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ============================================================================
# CORE ENUMS
# ============================================================================

class EntityType(str, Enum):
    PERSON = "PERSON"
    LOCATION = "LOCATION"
    PHONE = "PHONE"
    VEHICLE = "VEHICLE"
    ORGANIZATION = "ORGANIZATION"
    BANK_ACCOUNT = "BANK_ACCOUNT"
    DATE = "DATE"
    ALIAS = "ALIAS"
    CRYPTO_WALLET = "CRYPTO_WALLET"


class RelationType(str, Enum):
    PHONE_CALL = "phone_call"
    FINANCIAL_TRANSFER = "financial_transfer"
    FAMILY = "family"
    ASSOCIATE = "associate"
    SAME_ORGANIZATION = "same_organization"
    CO_LOCATION = "co_location"
    CO_ACCUSED = "co_accused"
    VICTIM_OF = "victim_of"
    WITNESS_TO = "witness_to"


class GraphRole(str, Enum):
    KINGPIN = "KINGPIN"
    BROKER = "BROKER"
    EXECUTOR = "EXECUTOR"


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


# ============================================================================
# NLP / ENTITY EXTRACTION
# ============================================================================

class Entity(BaseModel):
    """A single extracted entity with provenance."""

    id: Optional[str] = None
    type: EntityType
    value: str
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)

    extracted_from: str = Field(
        default="",
        description="For example FIR-2023/045 §3 or CDR row 12",
    )

    layer: Literal["spacy", "regex", "llm"] = "spacy"

    attributes: dict[str, Any] = Field(default_factory=dict)


class EntityExtractionRequest(BaseModel):
    case_id: Optional[str] = None
    text: str = Field(
        min_length=1,
        description="Raw FIR narrative text",
    )
    source_name: str = "manual"


class EntityExtractionResponse(BaseModel):
    entities: list[Entity] = Field(default_factory=list)
    relations: list[dict[str, Any]] = Field(default_factory=list)
    llm_used: bool = False
    warnings: list[str] = Field(default_factory=list)


class CDRExtractionRequest(BaseModel):
    rows: list[dict[str, Any]] = Field(default_factory=list)
    case_id: Optional[str] = None


class EntitySpan(BaseModel):
    text: str
    label: str
    start_char: int
    end_char: int
    confidence: float = 0.0
    source_sentence: str = ""


class NerResult(BaseModel):
    entities: list[EntitySpan] = Field(default_factory=list)
    model_used: str = ""
    total_entities: int = 0
    text_hash: str = ""


# ============================================================================
# V2 OCR
# ============================================================================

class OcrPageResult(BaseModel):
    page_number: int
    text: str
    confidence: float = Field(ge=0.0, le=100.0)
    language: str


class OcrResult(BaseModel):
    full_text: str
    pages: list[OcrPageResult] = Field(default_factory=list)
    detected_language: str
    average_confidence: float
    status: OCRStatus
    error_message: Optional[str] = None
    raw_text_hash: str


# ============================================================================
# V2 TRANSLATION
# ============================================================================

class TranslationResult(BaseModel):
    translated_text: str
    source_language: str
    target_language: str = "en"
    model_used: str
    status: TranslationStatus
    error_message: Optional[str] = None
    translated_text_hash: str


# ============================================================================
# V2 ENTITY RESOLUTION / SPLINK
# ============================================================================

class FieldScore(BaseModel):
    field_name: str
    score: float
    comparison_type: str


class ResolutionMatch(BaseModel):
    source_entity: str
    target_entity: str
    target_node_id: Optional[str] = None

    match_weight: float
    match_probability: float

    decision: str

    field_scores: list[FieldScore] = Field(default_factory=list)
    blocking_key: Optional[str] = None


class ResolutionResult(BaseModel):
    matches: list[ResolutionMatch] = Field(default_factory=list)
    new_entities: list[str] = Field(default_factory=list)
    merged_entities: list[str] = Field(default_factory=list)
    review_needed: list[str] = Field(default_factory=list)
    total_comparisons: int = 0


# ============================================================================
# V2 RELATIONSHIP EXTRACTION
# ============================================================================

class LlmRelation(BaseModel):
    source: str
    target: str
    relation: str
    evidence: str


class RelationshipResult(BaseModel):
    relations: list[LlmRelation] = Field(default_factory=list)

    mechanism: str = Field(
        default="COOCCURRENCE",
        description=(
            "GROQ_LLM | COOCCURRENCE | "
            "CDR_DIRECT | BANK_DIRECT"
        ),
    )


# ============================================================================
# V2 COMPLETE PIPELINE
# ============================================================================

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

    # Provenance
    ingestion_hash: str
    pipeline_version: str

    timeline_state: TimelineState = TimelineState.RECORDED

    # Performance
    total_duration_seconds: float
    stage_timings: list[PipelineStageTiming] = Field(
        default_factory=list
    )

    # Quality
    quality_warnings: list[str] = Field(default_factory=list)


class ProcessDocumentRequest(BaseModel):
    case_id: str
    document_type: str = "FIR"


# ============================================================================
# V2 FORENSIC PIPELINE API RESPONSE
# ============================================================================

class OCREntity(BaseModel):
    """Entity extracted by spaCy with source span."""

    text: str
    label: str
    start: int
    end: int
    source_sentence: str = ""
    page: int = 1


class PipelineStageStatus(BaseModel):
    stage: str
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

    entities: list[OCREntity] = Field(default_factory=list)
    relationships: list[dict[str, Any]] = Field(default_factory=list)

    # Resolution
    entities_merged: int = 0
    entities_flagged_for_review: int = 0

    # Metadata
    processing_time_seconds: float
    stage_errors: list[str] = Field(default_factory=list)


# ============================================================================
# PROVENANCE RESPONSE
#
# ONE class only — merged version of the two conflicting definitions.
# ============================================================================

class ProvenanceResponse(BaseModel):
    """Court-ready provenance chain for a document."""

    document_id: str
    case_id: Optional[str] = None

    # Hash chain
    ingestion_hash: Optional[str] = None
    raw_ocr_hash: Optional[str] = None
    translated_hash: Optional[str] = None

    hash_chain: dict[str, Any] = Field(default_factory=dict)

    # OCR
    ocr_language: Optional[str] = None
    ocr_confidence: Optional[float] = None

    # Translation
    translation_model: Optional[str] = None
    source_language: Optional[str] = None

    # Pipeline
    pipeline_version: str

    # Timeline
    timeline_state: str = "RECORDED"

    # Admissibility
    admissibility: str = "PENDING"

    # Timing
    ingested_at: Optional[str] = None
    processed_at: Optional[datetime] = None

    # Availability
    raw_text_available: bool = False
    translated_text_available: bool = False


# ============================================================================
# CROSS-REFERENCE
# ============================================================================

class CrossReferenceMatch(BaseModel):
    case_id: str
    case_number: str = ""
    score: float

    matched_entities: list[str] = Field(
        default_factory=list
    )

    matched_reason: str = ""


class CrossReferenceResponse(BaseModel):
    case_id: str
    matches: list[CrossReferenceMatch] = Field(
        default_factory=list
    )


# ============================================================================
# MO FINGERPRINT
# ============================================================================

class MOFeatures(BaseModel):
    entry_method: str = ""
    tools_used: list[str] = Field(default_factory=list)
    time_of_day: str = ""
    target_type: str = ""
    signature_traits: list[str] = Field(default_factory=list)
    summary: str = ""


class SimilarCase(BaseModel):
    case_id: str
    case_number: str = ""

    match_percentage: float = Field(
        ge=0.0,
        le=100.0,
    )

    matched_features: list[str] = Field(
        default_factory=list
    )


class MOFingerprintResponse(BaseModel):
    case_id: str
    features: MOFeatures

    similar_cases: list[SimilarCase] = Field(
        default_factory=list
    )


# ============================================================================
# GRAPH ANALYSIS
# ============================================================================

class GraphNode(BaseModel):
    id: str
    label: str
    entity_type: str = "PERSON"

    kingpin_score: float = 0.0
    role: GraphRole = GraphRole.EXECUTOR

    centrality: dict[str, float] = Field(
        default_factory=dict
    )


class GraphEdge(BaseModel):
    source: str
    target: str

    relation: RelationType
    weight: float = 1.0
    evidence: str = ""


class NetworkGraph(BaseModel):
    case_id: str

    nodes: list[GraphNode] = Field(
        default_factory=list
    )

    edges: list[GraphEdge] = Field(
        default_factory=list
    )

    metrics: dict[str, Any] = Field(
        default_factory=dict
    )


class KingpinScoreRow(BaseModel):
    entity_id: str
    label: str

    pagerank: float = 0.0
    betweenness: float = 0.0
    degree: float = 0.0
    eigenvector: float = 0.0

    composite: float = 0.0

    role: GraphRole = GraphRole.EXECUTOR


# ============================================================================
# GHOST LINK / LINK PREDICTION
# ============================================================================

class LinkPrediction(BaseModel):
    source: str
    target: str

    score: float

    algorithm: str = ""

    rationale: str = ""


class LinkPredictionResponse(BaseModel):
    case_id: str

    predictions: list[LinkPrediction] = Field(
        default_factory=list
    )

    threshold: float = 0.15


# ============================================================================
# CLUSTERING
# ============================================================================

class ClusterResult(BaseModel):
    suspect: str
    cluster: int

    silhouette: float = 0.0


# ============================================================================
# FINANCIAL
# ============================================================================

class TransactionsBody(BaseModel):
    transactions: list[dict[str, Any]] = Field(
        default_factory=list
    )

    source_account: str = ""
    target_account: str = ""


class TraceResult(BaseModel):
    path: list[str] = Field(default_factory=list)
    hops: int = 0
    amount: float = 0.0
    risk: str = "LOW"


# ============================================================================
# VISION
# ============================================================================

class VisionMatch(BaseModel):
    suspect_id: str
    name: str

    confidence: float = Field(
        ge=0.0,
        le=1.0,
    )

    notes: str = ""


class VisionMatchResponse(BaseModel):
    probe_image: str

    matches: list[VisionMatch] = Field(
        default_factory=list
    )

    model: str = "gemini-1.5-flash"


# ============================================================================
# DOSSIER
# ============================================================================

class DossierSection(BaseModel):
    title: str
    content: str = ""

    charts: list[str] = Field(
        default_factory=list
    )


class DossierResponse(BaseModel):
    case_id: str

    s3_url: str = ""
    local_path: str = ""

    page_count: int = 0
    sha256_hash: str = ""

    generated_at: datetime


# ============================================================================
# AGENTIC / LANGGRAPH
# ============================================================================

class AgentEvent(BaseModel):
    type: Literal[
        "start",
        "agent",
        "progress",
        "result",
        "error",
        "complete",
    ]

    node: str = ""
    message: str = ""

    data: dict[str, Any] = Field(
        default_factory=dict
    )

    timestamp: datetime = Field(
        default_factory=datetime.utcnow
    )


# ============================================================================
# INVESTIGATOR CHATBOT
# ============================================================================

class ChatIntent(str, Enum):
    FACTUAL_CASE = "factual_case"
    NETWORK_ANALYSIS = "network_analysis"
    FINANCIAL_TRAIL = "financial_trail"
    CRIME_THEORY = "crime_theory"
    CROSS_CASE = "cross_case"
    INTERROGATION = "interrogation"
    GENERAL = "general"


class ChatContextBundle(BaseModel):
    """Case data supplied by Node backend to the AI assistant."""

    case_id: str | None = None
    case_number: str = ""
    case_title: str = ""
    case_status: str = ""
    case_priority: str = ""
    jurisdiction: str = ""
    description: str = ""

    fir_texts: list[str] = Field(
        default_factory=list
    )

    entities: list[dict[str, Any]] = Field(
        default_factory=list
    )

    suspects: list[dict[str, Any]] = Field(
        default_factory=list
    )

    nodes: list[dict[str, Any]] = Field(
        default_factory=list
    )

    edges: list[dict[str, Any]] = Field(
        default_factory=list
    )

    transactions: list[dict[str, Any]] = Field(
        default_factory=list
    )

    call_records: list[dict[str, Any]] = Field(
        default_factory=list
    )

    evidence: list[dict[str, Any]] = Field(
        default_factory=list
    )

    alerts: list[dict[str, Any]] = Field(
        default_factory=list
    )


class ChatMessageIn(BaseModel):
    role: Literal[
        "user",
        "assistant",
        "system",
    ] = "user"

    content: str


class ChatRequest(BaseModel):
    """Request sent from Node -> AI /api/chat/query."""

    question: str = Field(
        min_length=1,
        max_length=2000,
    )

    case_id: str | None = None

    history: list[ChatMessageIn] = Field(
        default_factory=list
    )

    context: ChatContextBundle = Field(
        default_factory=ChatContextBundle
    )

    user_role: str = "INVESTIGATOR"
    user_name: str = "Officer"


class ChatStreamEvent(BaseModel):
    """SSE event emitted by /api/chat/query."""

    type: Literal[
        "intent",
        "context",
        "token",
        "citation",
        "done",
        "error",
    ]

    data: dict[str, Any] = Field(
        default_factory=dict
    )

    timestamp: datetime = Field(
        default_factory=datetime.utcnow
    )


# ============================================================================
# INTEGRITY / TAMPER CHECK
# ============================================================================

class IntegrityCheckResponse(BaseModel):
    """Result of tamper verification."""

    document_id: str
    is_valid: bool

    checks: list[dict[str, Any]] = Field(
        default_factory=list
    )

    error: Optional[str] = None

class ClusterResult(BaseModel):
    suspect: str
    cluster: int


class AnomalyResult(BaseModel):
    transaction_index: int
    score: float
    is_anomaly: bool
    reason: str = ""

class TraceRequest(BaseModel):
    source_account: str
    target_account: str
    transactions: list[dict[str, Any]] = Field(default_factory=list)


class TraceResult(BaseModel):
    path: list[str] = Field(default_factory=list)
    hops: int = 0
    found: bool = False
    layering_risk: str = "LOW"


class LaunderingRisk(BaseModel):
    case_id: str
    risk_level: str
    layered_paths: int
    max_layering_hops: int
    flagged_transactions: list[dict[str, Any]] = Field(default_factory=list)