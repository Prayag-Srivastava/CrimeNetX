"""
FastAPI router for police charge sheet generation & streaming.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.services.dossier_generator import OUTPUT_DIR, generate_dossier

router = APIRouter(prefix="/api/dossier", tags=["dossier"])
logger = logging.getLogger("crimenetx.dossier_router")


class GenerateDossierRequest(BaseModel):
    case: dict[str, Any]
    sections: dict[str, Any] = Field(default_factory=dict)
    evidence_qr_payload: Optional[str] = None
    language: str = "en"


@router.post("/generate/{case_id}")
async def generate_case_dossier(case_id: str, payload: GenerateDossierRequest):
    """Generates an official Form No. 5.11 charge sheet in the requested language."""
    try:
        case_data = payload.case
        case_data["id"] = case_id
        
        result = generate_dossier(
            case=case_data,
            sections=payload.sections,
            evidence_qr_payload=payload.evidence_qr_payload,
            language=payload.language or "en",
        )
        return result
    except Exception as exc:
        logger.exception("Charge sheet compilation failed for case %s: %s", case_id, exc)
        raise HTTPException(status_code=500, detail=f"Charge sheet compilation failed: {str(exc)}")


@router.get("/download/{filename}")
async def download_dossier_file(filename: str):
    """Streams the compiled PDF directly to the Node proxy."""
    file_path = OUTPUT_DIR / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Requested dossier PDF file not found on disk")

    return FileResponse(
        path=str(file_path),
        media_type="application/pdf",
        filename=filename,
    )