"""CrimeNetX — Pydantic v2 schemas for all AI-service request/response contracts."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class EntityType(str, Enum):
    PERSON = "PERSON"
    LOCATION = "LOCATION"
    PHONE = "PHONE"
    VEHICLE = "VEHICLE"
    ORGANIZATION = "ORGANIZATION"
    BANK_ACCOUNT = "BANK_ACCOUNT"
    CRYPTO_WALLET = "CRYPTO_WALLET"
    DATE = "DATE"
    ALIAS = "ALIAS"


class GraphRole(str, Enum):
    KINGPIN = "KINGPIN"
    BROKER = "BROKER"
    EXECUTOR = "EXECUTOR"


class RelationType(str, Enum):
    PHONE_CALL = "phone_call"
    FINANCIAL_TRANSFER = "financial_transfer"
    FAMILY = "family"
    ASSOCIATE = "associate"
    SAME_ORGANIZATION = "same_organization"
    CO_LOCATION = "co_location"


# ---------------------------------------------------------------------------
# NLP / Entity extraction
# ---------------------------------------------------------------------------
class Entity(BaseModel):
    """A single extracted entity with provenance (which pipeline layer found it)."""

    model_config = ConfigDict(extra="forbid")

    type: EntityType
    value: str
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)
    extracted_from: str = Field(default="", description="e.g. 'FIR-2023/045 §3', 'CDR row 12'")
    layer: Literal["spacy", "regex", "llm"] = "spacy"
    attributes: dict[str, Any] = Field(default_factory=dict)


class EntityExtractionRequest(BaseModel):
    case_id: str | None = None
    text: str = Field(min_length=1, description="Raw FIR narrative text")
    source_name: str = "manual"


class EntityExtractionResponse(BaseModel):
    entities: list[Entity]
    relations: list[dict[str, Any]] = Field(default_factory=list)
    llm_used: bool = False
    warnings: list[str] = Field(default_factory=list)


class CDRRow(BaseModel):
    from_number: str
    to_number: str
    duration_sec: int = 0
    call_time: datetime
    cell_tower: str = ""
    imei: str = ""


class CDRExtractionRequest(BaseModel):
    rows: list[CDRRow]


class BankTransaction(BaseModel):
    from_account: str
    to_account: str
    amount: float
    timestamp: datetime
    transaction_type: str = "NEFT"


# ---------------------------------------------------------------------------
# Graph ML
# ---------------------------------------------------------------------------
class GraphNode(BaseModel):
    id: str
    label: str
    entity_type: EntityType
    kingpin_score: float = 0.0
    role: GraphRole = GraphRole.EXECUTOR
    centrality: dict[str, float] = Field(default_factory=dict)
    meta: dict[str, Any] = Field(default_factory=dict)


class GraphEdge(BaseModel):
    source: str
    target: str
    relation: RelationType
    weight: float = 1.0
    evidence: str = ""
    timestamps: list[datetime] = Field(default_factory=list)


class NetworkGraph(BaseModel):
    case_id: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    metrics: dict[str, Any] = Field(default_factory=dict)


class KingpinScoreRow(BaseModel):
    entity_id: str
    label: str
    pagerank: float
    betweenness: float
    degree: float
    eigenvector: float
    composite: float
    role: GraphRole


class LinkPrediction(BaseModel):
    source: str
    target: str
    source_label: str = ""
    target_label: str = ""
    score: float = Field(ge=0.0, le=1.0)
    algorithm: str
    rationale: str = ""


class LinkPredictionResponse(BaseModel):
    case_id: str
    predictions: list[LinkPrediction]
    threshold: float = 0.15


class ClusterResult(BaseModel):
    suspect: str
    cluster: int = Field(ge=-1, description="-1 == noise/outlier (DBSCAN)")
    silhouette: float = 0.0


# ---------------------------------------------------------------------------
# Anomaly / financial
# ---------------------------------------------------------------------------
class TransactionFeature(BaseModel):
    from_account: str
    to_account: str
    amount: float
    timestamp: datetime
    txn_type: str = ""


class AnomalyResult(BaseModel):
    transaction_index: int
    score: float
    is_anomaly: bool
    reason: str = ""


class TraceRequest(BaseModel):
    case_id: str | None = None
    source_account: str
    target_account: str
    max_depth: int = 6


class TraceResult(BaseModel):
    path: list[str]
    hops: int
    found: bool
    layering_risk: str = "LOW"


class LaunderingRisk(BaseModel):
    case_id: str
    risk_level: str
    layered_paths: int
    max_layering_hops: int
    flagged_transactions: list[AnomalyResult] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Vision
# ---------------------------------------------------------------------------
class VisionMatch(BaseModel):
    suspect_id: str
    name: str
    confidence: float = Field(ge=0.0, le=1.0)
    notes: str = ""


class VisionMatchResponse(BaseModel):
    probe_image: str
    matches: list[VisionMatch] = Field(default_factory=list)
    model: str = "gemini-1.5-flash"


# ---------------------------------------------------------------------------
# Cross-reference & MO fingerprint
# ---------------------------------------------------------------------------
class CrossReferenceMatch(BaseModel):
    case_id: str
    case_number: str = ""
    score: float
    matched_entities: list[str] = Field(default_factory=list)
    matched_reason: str = ""


class CrossReferenceResponse(BaseModel):
    case_id: str
    matches: list[CrossReferenceMatch] = Field(default_factory=list)


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
    match_percentage: float = Field(ge=0.0, le=100.0)
    matched_features: list[str] = Field(default_factory=list)


class MOFingerprintResponse(BaseModel):
    case_id: str
    features: MOFeatures
    similar_cases: list[SimilarCase] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Dossier
# ---------------------------------------------------------------------------
class DossierSection(BaseModel):
    title: str
    content: str = ""
    charts: list[str] = Field(default_factory=list)


class DossierResponse(BaseModel):
    case_id: str
    s3_url: str = ""
    local_path: str = ""
    page_count: int = 0
    sha256_hash: str = ""
    generated_at: datetime


# ---------------------------------------------------------------------------
# Agentic (SSE progress events)
# ---------------------------------------------------------------------------
class AgentEvent(BaseModel):
    type: Literal["start", "agent", "progress", "result", "error", "complete"]
    node: str = ""
    message: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)

# ---------------------------------------------------------------------------
# Chatbot (Investigator Assistant)
# ---------------------------------------------------------------------------
class ChatIntent(str, Enum):
    """Detected user intent for routing to the right retrieval strategy."""
    FACTUAL_CASE = "factual_case"           # "who are the suspects in case X"
    NETWORK_ANALYSIS = "network_analysis"   # "who is the kingpin"
    FINANCIAL_TRAIL = "financial_trail"     # "trace the money flow"
    CRIME_THEORY = "crime_theory"           # "how was this crime executed"
    CROSS_CASE = "cross_case"               # "similar cases elsewhere"
    INTERROGATION = "interrogation"         # "what should i ask the suspect"
    GENERAL = "general"                     # fallback / greeting


class ChatContextBundle(BaseModel):
    """Pre-fetched case data sent by the Node backend along with the query."""
    case_id: str | None = None
    case_number: str = ""
    case_title: str = ""
    case_status: str = ""
    case_priority: str = ""
    jurisdiction: str = ""
    description: str = ""
    fir_texts: list[str] = Field(default_factory=list)
    entities: list[dict[str, Any]] = Field(default_factory=list)
    suspects: list[dict[str, Any]] = Field(default_factory=list)
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    transactions: list[dict[str, Any]] = Field(default_factory=list)
    call_records: list[dict[str, Any]] = Field(default_factory=list)
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    alerts: list[dict[str, Any]] = Field(default_factory=list)


class ChatMessageIn(BaseModel):
    role: Literal["user", "assistant", "system"] = "user"
    content: str


class ChatRequest(BaseModel):
    """Body sent from Node -> AI /api/chat/query."""
    question: str = Field(min_length=1, max_length=2000)
    case_id: str | None = None
    history: list[ChatMessageIn] = Field(default_factory=list)
    context: ChatContextBundle = Field(default_factory=ChatContextBundle)
    user_role: str = "INVESTIGATOR"
    user_name: str = "Officer"


class ChatStreamEvent(BaseModel):
    """SSE event emitted by /api/chat/query."""
    type: Literal["intent", "context", "token", "citation", "done", "error"]
    data: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
