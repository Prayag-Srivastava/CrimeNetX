"""Vision endpoints — CCTV matching and suspect-photo analysis (Gemini Vision)."""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.models.schemas import VisionMatchResponse
from app.services.vision_matcher import analyze_cctv_frame, match_cctv

router = APIRouter(prefix="/api/vision", tags=["Vision"])


async def _save_upload(file: UploadFile) -> str:
    suffix = Path(file.filename or "img.jpg").suffix or ".jpg"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.write(await file.read())
    tmp.close()
    return tmp.name


@router.post("/match-cctv", response_model=VisionMatchResponse)
async def match_cctv_endpoint(
    probe: UploadFile = File(...),
    gallery: str = Form(default="[]"),
):
    """Compare a CCTV screenshot against the suspect photo gallery.

    gallery: JSON array of [{"id","name","path"}] suspect photos.
    """
    try:
        gallery_list: list[dict[str, str]] = __import__("json").loads(gallery)
    except Exception as exc:
        raise HTTPException(400, "gallery must be valid JSON") from exc

    if not gallery_list:
        raise HTTPException(400, "gallery cannot be empty")

    probe_path = await _save_upload(probe)
    try:
        return match_cctv(probe_path, gallery_list)
    finally:
        Path(probe_path).unlink(missing_ok=True)


@router.post("/analyze-suspect-photo")
async def analyze_suspect_photo(
    photo: UploadFile = File(...),
    prompt: str = Form(default="Describe the person in this photo: age, build, distinguishing marks, clothing."),
):
    """Free-form Gemini Vision analysis of a suspect photo / CCTV frame."""
    path = await _save_upload(photo)
    try:
        return {"analysis": analyze_cctv_frame(path) or {"raw": "Gemini unavailable (set GEMINI_API_KEY)"}}
    finally:
        Path(path).unlink(missing_ok=True)


@router.post("/describe-cctv")
async def describe_cctv_endpoint(frame: UploadFile = File(...)):
    """Structured CCTV frame description (persons, vehicles, activity)."""
    path = await _save_upload(frame)
    try:
        result = analyze_cctv_frame(path)
        return {"description": result}
    finally:
        Path(path).unlink(missing_ok=True)
