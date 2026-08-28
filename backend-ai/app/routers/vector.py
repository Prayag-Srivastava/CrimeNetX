"""Vector endpoints — ChromaDB cross-referencing + MO fingerprinting."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from app.models.schemas import CrossReferenceResponse, MOFingerprintResponse
from app.services.cross_reference import cross_reference, index_case
from app.services.mo_fingerprint import fingerprint_case, similar_cases

router = APIRouter(prefix="/api/vector", tags=["Vector Search"])

from pydantic import BaseModel


class IndexCaseRequest(BaseModel):
    case_number: str = ""
    fir_text: str = ""
    source_date: str = ""


class XRefBody(BaseModel):
    case_id: str = ""
    fir_text: str = ""
    entities: list[dict[str, Any]] = []
    historical_cases: list[dict[str, Any]] | None = None


class MOBody(BaseModel):
    case_id: str = ""
    case_number: str = ""
    fir_text: str = ""


@router.post("/index/{case_id}")
async def index_case_endpoint(case_id: str, payload: IndexCaseRequest):
    """Index an FIR into ChromaDB for future cross-referencing."""
    if not payload.fir_text:
        raise HTTPException(400, "fir_text required")
    index_case(case_id, payload.case_number, payload.fir_text, payload.source_date)
    return {"indexed": case_id, "collection": "fir_embeddings"}


@router.post("/cross-reference/{case_id}", response_model=CrossReferenceResponse)
async def cross_reference_endpoint(case_id: str, payload: XRefBody):
    """Semantic + entity-overlap search against all historical FIRs."""
    return cross_reference(case_id, payload.fir_text, payload.entities, payload.historical_cases)


@router.post("/mo-fingerprint/{case_id}", response_model=MOFingerprintResponse)
async def mo_fingerprint_endpoint(case_id: str, payload: MOBody):
    """Extract MO, embed into ChromaDB, and return serial-offender matches."""
    if not payload.fir_text:
        raise HTTPException(400, "fir_text required")
    return fingerprint_case(case_id, payload.fir_text, payload.case_number)


@router.get("/similar-cases/{case_id}")
async def similar_cases_endpoint(case_id: str, query: str = ""):
    """Similar MO cases for a given case_id (or custom query text)."""
    return {"matches": similar_cases(case_id, query or None)}
