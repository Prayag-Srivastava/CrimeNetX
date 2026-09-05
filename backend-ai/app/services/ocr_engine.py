"""
CrimeNetX — Stage 1: Tesseract OCR Engine (Windows Poppler Auto-Finder)
========================================================================
Converts PDF files and scanned images into raw text.
Supports Hindi, Marathi, Tamil, Telugu, and English.
Preserves exact OCR output for court verification.
"""

import os
import io
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import pytesseract
from pdf2image import convert_from_path, convert_from_bytes
from PIL import Image

from app.config import (
    TESSERACT_CMD,
    OCR_DEFAULT_LANG,
    TESSERACT_PSM,
    TESSERACT_OEM,
    OCR_MIN_CONFIDENCE,
    PDF_DPI,
)

logger = logging.getLogger(__name__)

# Point pytesseract to the Tesseract binary
if TESSERACT_CMD:
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD


def _find_poppler_path() -> Optional[str]:
    """Auto-detect Poppler installation on Windows."""
    env_path = os.getenv("POPPLER_PATH")
    if env_path and Path(env_path).exists():
        return env_path

    if os.name == "nt":
        # Search common Windows paths where users extract Poppler
        search_roots = [
            Path(r"C:\Program Files"),
            Path(r"C:\Program Files (x86)"),
            Path(r"C:\poppler"),
            Path(r"C:\tools"),
            Path.home() / "Downloads",
            Path.home() / "Desktop",
        ]
        for root in search_roots:
            if root.exists():
                try:
                    for exe in root.glob("**/pdfinfo.exe"):
                        logger.info(f"Auto-detected Poppler at: {exe.parent}")
                        return str(exe.parent)
                except Exception:
                    continue
    return None


POPPLER_BIN_PATH = _find_poppler_path()


@dataclass
class OCRResult:
    """Output of the OCR pipeline for a single document."""
    text: str                          # Full extracted text (all pages combined)
    language: str                      # Tesseract language code used
    confidence: float                  # Average word-level confidence (0-100)
    page_count: int                    # Number of pages processed
    per_page_text: list[str] = field(default_factory=list)   # Text per page
    per_page_confidence: list[float] = field(default_factory=list)  # Confidence per page
    warnings: list[str] = field(default_factory=list)        # Any issues encountered
    success: bool = True


class OCREngine:
    """Tesseract-based OCR engine for FIR documents."""

    def __init__(self, default_lang: str = OCR_DEFAULT_LANG):
        self.default_lang = default_lang
        self.dpi = PDF_DPI
        self.poppler_path = POPPLER_BIN_PATH
        self._verify_tesseract()

    def _verify_tesseract(self):
        """Check that Tesseract is installed and accessible."""
        try:
            version = pytesseract.get_tesseract_version()
            logger.info(f"Tesseract OCR v{version} ready")
        except Exception as e:
            logger.error(f"Tesseract check failed at '{TESSERACT_CMD}': {e}")

    def _build_tesseract_config(self) -> str:
        """Build Tesseract configuration string."""
        return f"--oem {TESSERACT_OEM} --psm {TESSERACT_PSM}"

    def _extract_confidence(self, image: Image.Image, lang: str) -> tuple[str, float]:
        """Extract text and compute average confidence from a single image."""
        config = self._build_tesseract_config()
        try:
            data = pytesseract.image_to_data(
                image, lang=lang, config=config, output_type=pytesseract.Output.DICT
            )
            words = []
            confidences = []
            for i, word in enumerate(data["text"]):
                word = str(word).strip()
                try:
                    conf = int(data["conf"][i])
                except (ValueError, TypeError):
                    conf = -1
                if word and conf > OCR_MIN_CONFIDENCE:
                    words.append(word)
                    confidences.append(conf)

            text = " ".join(words)
            avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
            return text, avg_confidence
        except Exception as e:
            logger.warning(f"image_to_data failed for lang '{lang}': {e}, falling back to basic OCR")
            text = pytesseract.image_to_string(image, lang=lang, config=config)
            return text, 50.0

    def extract_from_pdf(
        self,
        file_path: str | Path,
        lang: Optional[str] = None,
    ) -> OCRResult:
        """Extract text from a PDF file using Tesseract OCR."""
        lang = lang or self.default_lang
        file_path = Path(file_path)

        if not file_path.exists():
            return OCRResult(
                text="", language=lang, confidence=0.0, page_count=0,
                success=False, warnings=[f"File not found: {file_path}"]
            )

        try:
            logger.info(f"Converting PDF to images at {self.dpi} DPI: {file_path.name}")
            kwargs = {"dpi": self.dpi}
            if self.poppler_path:
                kwargs["poppler_path"] = self.poppler_path

            images = convert_from_path(str(file_path), **kwargs)

            all_text = []
            all_confidences = []

            for page_num, image in enumerate(images, 1):
                text, confidence = self._extract_confidence(image, lang)
                all_text.append(text)
                all_confidences.append(confidence)

            full_text = "\n\n".join(all_text)
            avg_confidence = (
                sum(all_confidences) / len(all_confidences)
                if all_confidences else 0.0
            )

            warnings = []
            if avg_confidence < 40:
                warnings.append(
                    f"Low OCR confidence ({avg_confidence:.1f}%). Document may be handwritten or degraded."
                )

            return OCRResult(
                text=full_text,
                language=lang,
                confidence=round(avg_confidence, 2),
                page_count=len(images),
                per_page_text=all_text,
                per_page_confidence=[round(c, 2) for c in all_confidences],
                warnings=warnings,
                success=True,
            )

        except Exception as e:
            logger.error(f"OCR failed for {file_path}: {e}")
            return OCRResult(
                text="", language=lang, confidence=0.0, page_count=0,
                success=False, warnings=[str(e)]
            )

    def extract_from_bytes(
        self,
        pdf_bytes: bytes,
        lang: Optional[str] = None,
    ) -> OCRResult:
        """Extract text from PDF bytes."""
        lang = lang or self.default_lang
        try:
            kwargs = {"dpi": self.dpi}
            if self.poppler_path:
                kwargs["poppler_path"] = self.poppler_path

            images = convert_from_bytes(pdf_bytes, **kwargs)
            all_text = []
            all_confidences = []

            for image in images:
                text, confidence = self._extract_confidence(image, lang)
                all_text.append(text)
                all_confidences.append(confidence)

            full_text = "\n\n".join(all_text)
            avg_confidence = (
                sum(all_confidences) / len(all_confidences)
                if all_confidences else 0.0
            )

            return OCRResult(
                text=full_text,
                language=lang,
                confidence=round(avg_confidence, 2),
                page_count=len(images),
                per_page_text=all_text,
                per_page_confidence=[round(c, 2) for c in all_confidences],
                success=True,
            )

        except Exception as e:
            logger.error(f"OCR from bytes failed: {e}")
            return OCRResult(
                text="", language=lang, confidence=0.0, page_count=0,
                success=False, warnings=[str(e)]
            )


# Alias for backward compatibility
OcrEngine = OCREngine