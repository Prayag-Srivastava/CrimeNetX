"""Gemini client — used ONLY for multimodal vision tasks.

CrimeNetX policy: Gemini 1.5 Flash handles CCTV screenshot analysis and
suspect-photo matching because it is the strongest available multimodal model
here. Text/reasoning NEVER goes through Gemini (free tier quota exhausts fast
under agentic workloads) — that is Groq's job.
"""
from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import Any

from app.config import settings

logger = logging.getLogger("crimenetx.gemini")


def _model():
    if not settings.gemini_enabled:
        return None
    import google.generativeai as genai

    genai.configure(api_key=settings.gemini_api_key)
    return genai.GenerativeModel(settings.gemini_vision_model)


def analyze_image(image_path: str | Path, prompt: str) -> str:
    """Send one image to Gemini Vision and return the text analysis.

    Returns empty string when Gemini is not configured (callers fall back to
    deterministic perceptual hashing via vision_matcher).
    """
    model = _model()
    if model is None:
        logger.warning("GEMINI_API_KEY not set — vision degraded to perceptual-hash fallback")
        return ""
    try:
        image = Path(image_path)
        with open(image, "rb") as fh:
            mime = "image/jpeg" if image.suffix.lower() in (".jpg", ".jpeg") else "image/png"
            blob = {
                "mime_type": mime,
                "data": base64.b64encode(fh.read()).decode("utf-8"),
            }
        resp = model.generate_content([prompt, blob])
        return resp.text or ""
    except Exception as exc:
        logger.warning("Gemini vision call failed (%s)", exc)
        return ""


def describe_cctv(image_path: str | Path) -> dict[str, Any]:
    """Extract a structured description of a CCTV frame (people, vehicles, activity)."""
    text = analyze_image(
        image_path,
        "You are a CCTV forensic analyst. Describe in JSON: persons (count, rough "
        "appearance: clothing colors, height, distinguishing marks), vehicles (type, "
        "color, partial registration plate if readable), and activity (what is happening "
        "in the frame). Be concise and factual. JSON only.",
    )
    if not text:
        return {}
    import json
    import re

    try:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        return json.loads(match.group(0)) if match else {}
    except Exception:
        return {"raw": text}


def match_suspect_photo(probe_path: str | Path, gallery: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Ask Gemini to rank a probe photo against a gallery of suspect photos.

    gallery: [{"id": ..., "name": ..., "path": ...}] — returns scored matches.
    """
    model = _model()
    if model is None or not gallery:
        return []
    try:
        probe = Path(probe_path)
        probe_blob = {
            "mime_type": "image/jpeg",
            "data": base64.b64encode(probe.read_bytes()).decode("utf-8"),
        }
        gallery_blobs = []
        for g in gallery:
            p = Path(g["path"])
            if p.exists():
                gallery_blobs.append(
                    {
                        "mime_type": "image/jpeg",
                        "data": base64.b64encode(p.read_bytes()).decode("utf-8"),
                    }
                )
        if not gallery_blobs:
            return []
        parts = [probe_blob] + gallery_blobs
        prompt = (
            "This is a CCTV probe image followed by candidate suspect photos. "
            "Compare the probe to EACH candidate and return JSON: "
            '[{"index": 0, "confidence": 0.0-1.0, "notes": "..."}, ...]. '
            "Index 0 is the probe itself — skip it. JSON only."
        )
        resp = model.generate_content([prompt, *parts])
        import json
        import re

        match = re.search(r"\[.*\]", resp.text or "", re.DOTALL)
        if not match:
            return []
        scored = json.loads(match.group(0))
        return [
            {
                "suspect_id": gallery[i["index"] - 1]["id"],
                "name": gallery[i["index"] - 1]["name"],
                "confidence": float(i.get("confidence", 0)),
                "notes": i.get("notes", ""),
            }
            for i in scored
            if 1 <= int(i["index"]) <= len(gallery)
        ]
    except Exception as exc:
        logger.warning("match_suspect_photo failed (%s)", exc)
        return []
