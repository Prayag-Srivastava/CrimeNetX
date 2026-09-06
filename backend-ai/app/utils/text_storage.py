"""
CrimeNetX — Safe Text Storage & Hashing
========================================
Stores raw OCR text and translated text with SHA-256 hashes.
Creates the chain of custody: Original File → OCR Text → Translated Text.
Every hash is preserved for court verification.
"""

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.config import RAW_TEXT_STORAGE_DIR, PIPELINE_VERSION

logger = logging.getLogger(__name__)


def compute_sha256(text: str) -> str:
    """Compute SHA-256 hash of a text string."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def compute_file_sha256(file_path: str | Path) -> str:
    """Compute SHA-256 hash of a file on disk."""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


class TextStorage:
    """
    Manages safe storage of raw and translated text with full provenance.
    """

    def __init__(self, base_dir: Optional[Path] = None):
        self.base_dir = base_dir or RAW_TEXT_STORAGE_DIR
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def store_document(
        self,
        case_id: str,
        document_id: str,
        raw_ocr_text: str,
        translated_text: str,
        ocr_language: str,
        ocr_confidence: float,
        source_language: str,
        original_filename: str,
        original_file_hash: str,
        translation_model: str = "ai4bharat/indictrans2-indic-en-dist-200M",
    ) -> dict:
        """Store raw OCR text + translated text + provenance metadata."""
        case_dir = self.base_dir / case_id
        case_dir.mkdir(parents=True, exist_ok=True)

        raw_hash = compute_sha256(raw_ocr_text)
        translated_hash = compute_sha256(translated_text)

        raw_path = case_dir / f"{document_id}_raw.txt"
        raw_path.write_text(raw_ocr_text, encoding="utf-8")

        translated_path = case_dir / f"{document_id}_translated.txt"
        translated_path.write_text(translated_text, encoding="utf-8")

        provenance = {
            "document_id": document_id,
            "case_id": case_id,
            "original_filename": original_filename,
            "original_file_hash": original_file_hash,
            "pipeline_version": PIPELINE_VERSION,
            "stages": {
                "ocr": {
                    "raw_text_hash": raw_hash,
                    "language": ocr_language,
                    "confidence": ocr_confidence,
                    "raw_text_file": str(raw_path),
                },
                "translation": {
                    "translated_text_hash": translated_hash,
                    "source_language": source_language,
                    "model": translation_model,
                    "translated_text_file": str(translated_path),
                },
            },
            "hash_chain": {
                "step_1_original_file": original_file_hash,
                "step_2_ocr_text": raw_hash,
                "step_3_translated_text": translated_hash,
            },
            "timestamps": {
                "ingested_at": datetime.now(timezone.utc).isoformat(),
            },
        }

        provenance_path = case_dir / f"{document_id}_provenance.json"
        provenance_path.write_text(
            json.dumps(provenance, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        return provenance

    def verify_integrity(self, case_id: str, document_id: str) -> dict:
        """Verify that stored text files match recorded hashes."""
        case_dir = self.base_dir / case_id
        provenance_path = case_dir / f"{document_id}_provenance.json"

        if not provenance_path.exists():
            return {"valid": False, "error": "Provenance record not found"}

        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        results = {"valid": True, "checks": []}

        raw_path = case_dir / f"{document_id}_raw.txt"
        if raw_path.exists():
            current_raw_hash = compute_sha256(raw_path.read_text(encoding="utf-8"))
            expected_raw_hash = provenance["stages"]["ocr"]["raw_text_hash"]
            raw_ok = current_raw_hash == expected_raw_hash
            results["checks"].append({
                "stage": "ocr",
                "expected": expected_raw_hash[:16] + "...",
                "actual": current_raw_hash[:16] + "...",
                "match": raw_ok,
            })
            if not raw_ok:
                results["valid"] = False
        else:
            results["checks"].append({"stage": "ocr", "error": "File missing"})
            results["valid"] = False

        trans_path = case_dir / f"{document_id}_translated.txt"
        if trans_path.exists():
            current_trans_hash = compute_sha256(trans_path.read_text(encoding="utf-8"))
            expected_trans_hash = provenance["stages"]["translation"]["translated_text_hash"]
            trans_ok = current_trans_hash == expected_trans_hash
            results["checks"].append({
                "stage": "translation",
                "expected": expected_trans_hash[:16] + "...",
                "actual": current_trans_hash[:16] + "...",
                "match": trans_ok,
            })
            if not trans_ok:
                results["valid"] = False
        else:
            results["checks"].append({"stage": "translation", "error": "File missing"})
            results["valid"] = False

        return results

    def get_raw_text(self, case_id: str, document_id: str) -> Optional[str]:
        """Retrieve original OCR text."""
        path = self.base_dir / case_id / f"{document_id}_raw.txt"
        return path.read_text(encoding="utf-8") if path.exists() else None

    def get_translated_text(self, case_id: str, document_id: str) -> Optional[str]:
        """Retrieve translated text."""
        path = self.base_dir / case_id / f"{document_id}_translated.txt"
        return path.read_text(encoding="utf-8") if path.exists() else None