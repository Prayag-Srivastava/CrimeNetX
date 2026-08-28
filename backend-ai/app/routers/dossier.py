"""Dossier endpoints — PDF generation."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.services.dossier_generator import generate_dossier

router = APIRouter(prefix="/api/dossier", tags=["Dossier"])
GENERATED_DOSSIERS_DIR = Path(__file__).resolve().parent.parent / "generated_dossiers"

class DossierRequest(BaseModel):
    case: dict[str, Any] = Field(default_factory=dict)
    sections: dict[str, Any] = Field(default_factory=dict)
    evidence_qr_payload: str | None = None


@router.post("/generate/{case_id}")
async def generate(case_id: str, payload: DossierRequest):
    """Generate the investigation dossier PDF for a case."""
    if not payload.case:
        raise HTTPException(400, "case metadata required (caseNumber, title, description…)")
    result = generate_dossier({**payload.case, "id": case_id}, payload.sections, payload.evidence_qr_payload)
    return result


@router.get("/download/{path:path}")
async def download(path: str):
    """Download a previously generated dossier by filename."""
    safe = Path(path).name
    file_path = GENERATED_DOSSIERS_DIR / safe

    if not file_path.exists():
        raise HTTPException(404, "dossier not found")

    return FileResponse(
        str(file_path),
        media_type="application/pdf",
        filename=safe,
    )
