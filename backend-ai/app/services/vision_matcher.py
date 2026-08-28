"""Multimodal CCTV Suspect Matcher.

Primary path: Gemini 1.5 Flash Vision compares the probe CCTV frame against the
suspect photo gallery (identity-level understanding: face, build, clothing).

Fallback (no GEMINI_API_KEY): deterministic perceptual-hash + color-histogram
similarity so the endpoint still returns ranked matches in demo mode.
"""
from __future__ import annotations

import logging
from pathlib import Path

from app.config import settings
from app.llm.gemini_client import match_suspect_photo, describe_cctv
from app.models.schemas import VisionMatch, VisionMatchResponse

logger = logging.getLogger("crimenetx.vision")


def match_cctv(probe_path: str | Path, gallery: list[dict[str, str]]) -> VisionMatchResponse:
    """gallery: [{"id","name","path"}] — suspect photo gallery."""
    probe = Path(probe_path)
    if not probe.exists():
        raise FileNotFoundError(f"probe image not found: {probe}")

    if settings.gemini_enabled and gallery:
        matches = match_suspect_photo(probe, gallery)
        if matches:
            return VisionMatchResponse(
                probe_image=str(probe),
                matches=[VisionMatch(**m) for m in matches[:3]],
                model=settings.gemini_vision_model,
            )

    # --- Deterministic fallback: perceptual hashing + color histogram -------
    scored = []
    probe_desc = _image_summary(probe)
    for g in gallery:
        p = Path(g["path"])
        if not p.exists():
            continue
        sim = _image_similarity(probe, p)
        scored.append(
            VisionMatch(
                suspect_id=g["id"],
                name=g["name"],
                confidence=round(sim, 3),
                notes="Perceptual-hash fallback (set GEMINI_API_KEY for semantic vision matching).",
            )
        )
    scored.sort(key=lambda m: m.confidence, reverse=True)
    return VisionMatchResponse(
        probe_image=str(probe),
        matches=scored[:3],
        model="perceptual-hash-fallback",
    )


def analyze_cctv_frame(image_path: str | Path) -> dict:
    """Describe persons/vehicles/activity in a CCTV frame (Gemini; empty fallback)."""
    return describe_cctv(image_path)


def _image_summary(path: Path) -> tuple:
    """64-bit perceptual hash + 16-bin RGB histogram (normalized)."""
    from PIL import Image
    import numpy as np

    img = Image.open(path).convert("RGB").resize((8, 8))
    arr = np.asarray(img, dtype=float)
    avg = arr.mean()
    phash = int("".join("1" if v > avg else "0" for v in arr.flatten()), 2)
    hist = Image.open(path).convert("RGB").resize((32, 32)).histogram()
    norm = np.array(hist, dtype=float)
    norm = norm / (norm.sum() + 1e-9)
    return phash, norm


def _image_similarity(a: Path, b: Path) -> float:
    try:
        pa, ha = _image_summary(a)
        pb, hb = _image_summary(b)
    except Exception:
        return 0.0
    # Hamming distance on the 64-bit hash -> similarity 0..1
    hamming = bin(pa ^ pb).count("1")
    hash_sim = 1.0 - hamming / 64.0
    # Cosine similarity on histograms
    import numpy as np

    cos = float(np.dot(ha, hb) / (np.linalg.norm(ha) * np.linalg.norm(hb) + 1e-9))
    return 0.7 * hash_sim + 0.3 * cos
