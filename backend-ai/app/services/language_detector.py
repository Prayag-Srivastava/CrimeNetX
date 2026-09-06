"""
CrimeNetX — Language Detection Service
=======================================
Detects OCR text language and maps it to:
  - ISO code: hi, mr, en...
  - Tesseract code: hin, mar, eng...
  - IndicTrans2 code: hin_Deva, mar_Deva, eng_Latn...
"""

import logging
import unicodedata
from collections import Counter
from dataclasses import dataclass, field

from langdetect import detect, DetectorFactory

DetectorFactory.seed = 42
logger = logging.getLogger(__name__)


@dataclass
class DetectionResult:
    language: str              # ISO: hi, mr, en
    tesseract_code: str        # hin, mar, eng
    indictrans_code: str       # hin_Deva, mar_Deva, eng_Latn
    confidence: float
    method: str
    is_english: bool
    scripts_found: list[str] = field(default_factory=list)


ISO_TO_TESSERACT = {
    "hi": "hin",
    "mr": "mar",
    "ta": "tam",
    "te": "tel",
    "bn": "ben",
    "gu": "guj",
    "kn": "kan",
    "ml": "mal",
    "pa": "pan",
    "ur": "urd",
    "en": "eng",
}

ISO_TO_INDICTRANS = {
    "hi": "hin_Deva",
    "mr": "mar_Deva",
    "ta": "tam_Taml",
    "te": "tel_Telu",
    "bn": "ben_Beng",
    "gu": "guj_Gujr",
    "kn": "kan_Knda",
    "ml": "mal_Mlym",
    "pa": "pan_Guru",
    "ur": "urd_Arab",
    "en": "eng_Latn",
}

SCRIPT_TO_ISO = {
    "DEVANAGARI": "hi",
    "TAMIL": "ta",
    "TELUGU": "te",
    "BENGALI": "bn",
    "GUJARATI": "gu",
    "KANNADA": "kn",
    "MALAYALAM": "ml",
    "GURMUKHI": "pa",
    "ARABIC": "ur",
    "LATIN": "en",
}


def _detect_scripts(text: str) -> Counter:
    counts = Counter()
    for ch in text:
        if ch.isspace() or ch.isdigit() or ch in ".,;:!?()-/\"'":
            continue
        try:
            name = unicodedata.name(ch, "")
            script = name.split()[0] if name else "UNKNOWN"
            counts[script] += 1
        except ValueError:
            counts["UNKNOWN"] += 1
    return counts


def _devanagari_to_language(text: str) -> str:
    marathi_chars = set("ळऱ")
    marathi_words = {"आहे", "आहेत", "नाही", "काय", "कसे", "म्हणून", "पण", "तर"}
    hindi_words = {"है", "हैं", "नहीं", "क्या", "कैसे", "लिए", "भी", "तो"}

    marathi_score = sum(1 for c in text if c in marathi_chars)
    marathi_score += sum(1 for w in marathi_words if w in text)
    hindi_score = sum(1 for w in hindi_words if w in text)
    return "mr" if marathi_score > hindi_score else "hi"


def map_iso_to_codes(iso_code: str) -> tuple[str, str, str]:
    """Return (iso, tesseract, indictrans)."""
    iso = (iso_code or "hi").strip().lower()[:2]
    if iso not in ISO_TO_INDICTRANS:
        iso = "hi"
    return iso, ISO_TO_TESSERACT[iso], ISO_TO_INDICTRANS[iso]


class LanguageDetector:
    def detect(self, text: str) -> DetectionResult:
        if not text or len(text.strip()) < 10:
            iso, tess, indic = map_iso_to_codes("en")
            return DetectionResult(
                language=iso,
                tesseract_code=tess,
                indictrans_code=indic,
                confidence=0.3,
                method="fallback",
                is_english=True,
                scripts_found=["LATIN"],
            )

        script_counts = _detect_scripts(text)
        total = sum(script_counts.values())
        scripts_found = list(script_counts.keys())

        if total == 0:
            iso, tess, indic = map_iso_to_codes("en")
            return DetectionResult(
                language=iso,
                tesseract_code=tess,
                indictrans_code=indic,
                confidence=0.5,
                method="fallback",
                is_english=True,
                scripts_found=[],
            )

        dominant_script, dominant_count = script_counts.most_common(1)[0]
        dominant_ratio = dominant_count / total

        if dominant_script in SCRIPT_TO_ISO and dominant_ratio > 0.3:
            iso = SCRIPT_TO_ISO[dominant_script]
            if dominant_script == "DEVANAGARI":
                iso = _devanagari_to_language(text)

            iso, tess, indic = map_iso_to_codes(iso)
            latin_ratio = script_counts.get("LATIN", 0) / total
            method = "mixed" if latin_ratio > 0.2 else "script"

            return DetectionResult(
                language=iso,
                tesseract_code=tess,
                indictrans_code=indic,
                confidence=round(min(dominant_ratio + 0.2, 1.0), 2),
                method=method,
                is_english=(iso == "en"),
                scripts_found=scripts_found,
            )

        try:
            detected = detect(text)
            iso, tess, indic = map_iso_to_codes(detected)
            return DetectionResult(
                language=iso,
                tesseract_code=tess,
                indictrans_code=indic,
                confidence=0.85,
                method="statistical",
                is_english=(iso == "en"),
                scripts_found=scripts_found,
            )
        except Exception as e:
            logger.warning(f"Statistical detection failed: {e}")
            iso, tess, indic = map_iso_to_codes("en")
            return DetectionResult(
                language=iso,
                tesseract_code=tess,
                indictrans_code=indic,
                confidence=0.4,
                method="fallback",
                is_english=True,
                scripts_found=scripts_found,
            )

    def from_force_language(self, force_language: str) -> DetectionResult:
        """Investigator manually selected language on upload."""
        iso, tess, indic = map_iso_to_codes(force_language)
        return DetectionResult(
            language=iso,
            tesseract_code=tess,
            indictrans_code=indic,
            confidence=1.0,
            method="investigator_selected",
            is_english=(iso == "en"),
            scripts_found=[],
        )