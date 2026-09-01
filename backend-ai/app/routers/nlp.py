"""NLP endpoints — entity extraction from FIR text/PDF, CDR CSV, bank CSV."""
from __future__ import annotations
from app.services.crime_simulator import generate_execution_simulation

import io
from typing import Any

import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile

from app.models.schemas import (
    CDRExtractionRequest,
    EntityExtractionRequest,
    EntityExtractionResponse,
)
from app.services.nlp_extractor import extract_entities, extract_from_bank, extract_from_cdr
from app.utils.pdf_parser import parse_fir_pdf

router = APIRouter(prefix="/api/nlp", tags=["NLP"])


@router.post("/extract-entities", response_model=EntityExtractionResponse)
async def extract_entities_endpoint(req: EntityExtractionRequest):
    """Extract entities from raw FIR narrative text (or PDF text)."""
    if not req.text.strip():
        raise HTTPException(400, "text must not be empty")
    return extract_entities(req.text, req.source_name, req.case_id)


@router.post("/extract-from-pdf", response_model=EntityExtractionResponse)
async def extract_from_pdf(file: UploadFile = File(...)):
    """Upload an FIR PDF — parse text + forensics metadata, then extract entities."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")
    try:
        text, metadata = parse_fir_pdf(io.BytesIO(await file.read()))
    except Exception as exc:
        raise HTTPException(422, f"PDF parsing failed: {exc}") from exc
    if not text.strip():
        raise HTTPException(422, "No extractable text found in PDF (scanned image PDFs need OCR)")
    resp = extract_entities(text, file.filename or "fir.pdf", None)
    resp.warnings.append(f"PDF metadata: {metadata}")
    return resp


@router.post("/extract-from-cdr", response_model=EntityExtractionResponse)
async def extract_from_cdr_endpoint(file: UploadFile = File(...)):
    """CDR CSV upload — columns: from_number,to_number,duration_sec,call_time,cell_tower,imei"""
    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(422, f"CSV parse failed: {exc}") from exc
    required = {"from_number", "to_number"}
    if not required.issubset(df.columns):
        raise HTTPException(422, f"CSV must contain columns: {required}")

    df = df.fillna("")
    rows = df.to_dict("records")
    import datetime as dt

    normalized: list[dict[str, Any]] = []
    for r in rows:
        call_time = r.get("call_time") or ""
        try:
            ts = pd.to_datetime(call_time).to_pydatetime()
        except Exception:
            ts = dt.datetime.utcnow()
        normalized.append(
            {
                "from_number": str(r.get("from_number", "")).strip(),
                "to_number": str(r.get("to_number", "")).strip(),
                "duration_sec": int(r.get("duration_sec", 0) or 0),
                "call_time": ts,
                "cell_tower": str(r.get("cell_tower", "")),
                "imei": str(r.get("imei", "")),
            }
        )
    return extract_from_cdr(normalized)

@router.post("/generate-simulation")
async def generate_simulation_endpoint(payload: dict):
    case_title = payload.get("title", "")
    case_description = payload.get("description", "")
    entities = payload.get("entities", [])
    
    result = generate_execution_simulation(case_title, case_description, entities)
    return result

@router.post("/extract-from-bank", response_model=EntityExtractionResponse)
async def extract_from_bank_endpoint(file: UploadFile = File(...)):
    """Bank statement CSV upload — columns: from_account,to_account,amount,timestamp,transaction_type"""
    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(422, f"CSV parse failed: {exc}") from exc
    required = {"from_account", "to_account", "amount"}
    if not required.issubset(df.columns):
        raise HTTPException(422, f"CSV must contain columns: {required}")

    import datetime as dt

    txns = []
    for r in df.fillna("").to_dict("records"):
        try:
            ts = pd.to_datetime(r.get("timestamp") or "").to_pydatetime()
        except Exception:
            ts = dt.datetime.utcnow()
        txns.append(
            {
                "from_account": str(r.get("from_account", "")).strip(),
                "to_account": str(r.get("to_account", "")).strip(),
                "amount": float(r.get("amount", 0) or 0),
                "timestamp": ts,
                "transaction_type": str(r.get("transaction_type", "NEFT")),
            }
        )
    return extract_from_bank(txns)
