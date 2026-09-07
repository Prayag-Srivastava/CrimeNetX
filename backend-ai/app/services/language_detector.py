"""
CrimeNetX — Language Detection Service (v2.2 — all 22 IndicTrans2 languages)
=============================================================================
Detects OCR text language and maps it to:
  - ISO code:        hi, mr, ta, sat, mni...
  - Tesseract code:  hin, mar, tam, sat, mni...
  - IndicTrans2 code: hin_Deva, mar_Deva, tam_Taml, sat_Olck, mni_Beng...

WHAT CHANGED IN v2.2
--------------------
Previously only 11 languages were supported and ANY unknown language
silently fell back to Hindi (`map_iso_to_codes` forced iso="hi"), which
meant e.g. Odia or Assamese FIRs were translated with the wrong source
tag and produced garbage.

Now:
  * All 22 scheduled Indian languages IndicTrans2 supports, + English.
  * Multi-language script disambiguation, not just Devanagari:
      - Devanagari -> hi / mr / ne / sa / doi / mai / kok / brx
      - Bengali    -> bn / as / mni   (Manipuri uses Bengali script)
      - Ol Chiki   -> sat
      - Arabic     -> ur / sd / ks
  * Unknown language falls back to ENGLISH (identity, no translation)
    instead of silently mislabelling as Hindi.
  * Tesseract codes fall back by SCRIPT for languages Tesseract lacks
    (Dogri/Maithili/Konkani/Bodo all render in Devanagari -> "hin").
  * langdetect's 3-letter and regional codes (zh-cn, pa, ne) normalised.
"""

import logging
import unicodedata
from collections import Counter
from dataclasses import dataclass, field

from langdetect import detect_langs, DetectorFactory

DetectorFactory.seed = 42
logger = logging.getLogger(__name__)


@dataclass
class DetectionResult:
    language: str              # ISO: hi, mr, ta, sat, en
    tesseract_code: str        # hin, mar, tam, sat, eng
    indictrans_code: str       # hin_Deva, mar_Deva, tam_Taml, sat_Olck, eng_Latn
    confidence: float
    method: str
    is_english: bool
    scripts_found: list[str] = field(default_factory=list)
    script: str = ""           # dominant script, e.g. DEVANAGARI


# ================================================================
# All 22 scheduled languages supported by IndicTrans2 + English
# ================================================================
ISO_TO_INDICTRANS = {
    "as":  "asm_Beng",   # Assamese
    "bn":  "ben_Beng",   # Bengali
    "brx": "brx_Deva",   # Bodo
    "doi": "doi_Deva",   # Dogri
    "gu":  "guj_Gujr",   # Gujarati
    "hi":  "hin_Deva",   # Hindi
    "kn":  "kan_Knda",   # Kannada
    "ks":  "kas_Arab",   # Kashmiri (Perso-Arabic)
    "kok": "gom_Deva",   # Konkani/Goan
    "mai": "mai_Deva",   # Maithili
    "ml":  "mal_Mlym",   # Malayalam
    "mni": "mni_Beng",   # Manipuri/Meitei (Bengali script)
    "mr":  "mar_Deva",   # Marathi
    "ne":  "npi_Deva",   # Nepali
    "or":  "ory_Orya",   # Odia
    "pa":  "pan_Guru",   # Punjabi
    "sa":  "san_Deva",   # Sanskrit
    "sat": "sat_Olck",   # Santali (Ol Chiki)
    "sd":  "snd_Arab",   # Sindhi
    "ta":  "tam_Taml",   # Tamil
    "te":  "tel_Telu",   # Telugu
    "ur":  "urd_Arab",   # Urdu
    "en":  "eng_Latn",   # English (identity)
}

# Tesseract traineddata codes. Where Tesseract has no model for a language
# we fall back to another language in the SAME script — OCR only needs the
# script to be right; IndicTrans2 gets the precise language tag separately.
ISO_TO_TESSERACT = {
    "as":  "asm",
    "bn":  "ben",
    "brx": "hin",   # Bodo -> Devanagari
    "doi": "hin",   # Dogri -> Devanagari
    "gu":  "guj",
    "hi":  "hin",
    "kn":  "kan",
    "ks":  "urd",   # Kashmiri -> Perso-Arabic
    "kok": "mar",   # Konkani -> Devanagari (Marathi model is closest)
    "mai": "hin",   # Maithili -> Devanagari
    "ml":  "mal",
    "mni": "ben",   # Manipuri -> Bengali script
    "mr":  "mar",
    "ne":  "nep",
    "or":  "ori",
    "pa":  "pan",
    "sa":  "san",
    "sat": "sat",
    "sd":  "snd",
    "ta":  "tam",
    "te":  "tel",
    "ur":  "urd",
    "en":  "eng",
}

# Dominant Unicode script -> default ISO language (refined below per script)
SCRIPT_TO_ISO = {
    "DEVANAGARI": "hi",
    "BENGALI":    "bn",
    "GUJARATI":   "gu",
    "GURMUKHI":   "pa",
    "KANNADA":    "kn",
    "MALAYALAM":  "ml",
    "ORIYA":      "or",
    "ODIA":       "or",
    "TAMIL":      "ta",
    "TELUGU":     "te",
    "ARABIC":     "ur",
    "OL":         "sat",   # OL CHIKI LETTER ...
    "MEETEI":     "mni",   # MEETEI MAYEK LETTER ...
    "LATIN":      "en",
}

# Every non-Latin script we can translate from
INDIC_SCRIPTS = {
    "DEVANAGARI", "BENGALI", "GUJARATI", "GURMUKHI", "KANNADA",
    "MALAYALAM", "ORIYA", "ODIA", "TAMIL", "TELUGU", "ARABIC",
    "OL", "MEETEI", "THAANA", "SINHALA",
}

# Normalise langdetect / user input variants onto our ISO keys
_ISO_ALIASES = {
    "hin": "hi", "mar": "mr", "tam": "ta", "tel": "te", "ben": "bn",
    "guj": "gu", "kan": "kn", "mal": "ml", "pan": "pa", "urd": "ur",
    "asm": "as", "ori": "or", "ory": "or", "nep": "ne", "npi": "ne",
    "san": "sa", "snd": "sd", "kas": "ks", "gom": "kok", "kok": "kok",
    "mni": "mni", "sat": "sat", "brx": "brx", "doi": "doi", "mai": "mai",
    "eng": "en", "en-us": "en", "en-gb": "en", "pa-in": "pa", "zh-cn": "en",
    "ko": "kok",  # langdetect sometimes emits 'ko' for Konkani-like input
}


# ================================================================
# Script-level disambiguation (word/character heuristics)
# ================================================================

_DEVANAGARI_MARKERS = {
    "mr": {
        "chars": set("ळऱ"),
        "words": {"आहे", "आहेत", "नाही", "काय", "कसे", "म्हणून", "पण", "तर",
                  "यांनी", "त्यांनी", "करून", "मध्ये", "व", "अशी"},
    },
    "ne": {
        "chars": set(),
        "words": {"छ", "छन्", "गरेको", "भएको", "हुन्", "तर्", "नेपाल",
                  "गर्ने", "भन्ने", "अनि", "पनि"},
    },
    "sa": {
        "chars": set(),
        "words": {"च", "एव", "अस्ति", "भवति", "इति", "तत्", "यत्", "सर्वम्"},
    },
    "mai": {
        "chars": set(),
        "words": {"अछि", "छथि", "हमर", "अहाँ", "कएल", "गेल"},
    },
    "brx": {
        "chars": set(),
        "words": {"आरो", "बर'", "मोनसे", "थांनाय"},
    },
    "kok": {
        "chars": set(),
        "words": {"आसा", "केल्ले", "म्हण", "तांणी", "गोंय"},
    },
    "doi": {
        "chars": set(),
        "words": {"ऐ", "गेदा", "तुसें", "डोगरी"},
    },
    "hi": {
        "chars": set(),
        "words": {"है", "हैं", "नहीं", "क्या", "कैसे", "लिए", "भी", "तो",
                  "किया", "उसने", "गया", "साथ", "करने", "वाले"},
    },
}

_BENGALI_MARKERS = {
    "as": {"words": {"অসম", "কৰি", "হৈছে", "আৰু", "কৰা", "লগত", "তেওঁ"},
           "chars": set("ৰৱ")},
    "mni": {"words": {"অমসুং", "মখোয়", "অদু", "তৌরে", "মনিপুর"},
            "chars": set()},
    "bn": {"words": {"এবং", "করে", "হয়েছে", "তিনি", "থেকে", "সঙ্গে", "করা"},
           "chars": set()},
}

_ARABIC_MARKERS = {
    "sd": {"words": {"۽", "آهي", "هئا", "سنڌ", "ڪري"}, "chars": set("ڪڊڏڱ")},
    "ks": {"words": {"چھُ", "کٲشُر", "تہٕ", "زِ"}, "chars": set("ٲٹۍ")},
    "ur": {"words": {"ہے", "اور", "نہیں", "کیا", "گیا", "کے", "میں", "کی"},
           "chars": set()},
}


def _score_markers(text: str, markers: dict, default: str) -> str:
    """Pick the language whose marker words/chars appear most often."""
    scores: dict[str, int] = {}
    for lang, spec in markers.items():
        score = sum(2 for w in spec["words"] if w in text)
        score += sum(1 for c in text if c in spec["chars"])
        scores[lang] = score

    best = max(scores, key=lambda k: scores[k])
    return best if scores[best] > 0 else default


def _disambiguate_script(script: str, text: str) -> str:
    if script == "DEVANAGARI":
        return _score_markers(text, _DEVANAGARI_MARKERS, "hi")
    if script == "BENGALI":
        return _score_markers(text, _BENGALI_MARKERS, "bn")
    if script == "ARABIC":
        return _score_markers(text, _ARABIC_MARKERS, "ur")
    return SCRIPT_TO_ISO.get(script, "en")


def _script_of(ch: str) -> str:
    try:
        name = unicodedata.name(ch, "")
    except ValueError:
        return "UNKNOWN"
    return name.split()[0] if name else "UNKNOWN"


def _detect_scripts(text: str) -> Counter:
    counts = Counter()
    for ch in text:
        if ch.isspace() or ch.isdigit() or ch in ".,;:!?()-/\"'“”‘’[]{}<>|@#$%^&*_+=~`":
            continue
        counts[_script_of(ch)] += 1
    return counts


def normalize_iso(code: str) -> str:
    """Map any incoming language code onto a supported ISO key."""
    raw = (code or "").strip().lower().replace("_", "-")
    if not raw:
        return "en"
    if raw in ISO_TO_INDICTRANS:
        return raw
    if raw in _ISO_ALIASES:
        return _ISO_ALIASES[raw]
    # IndicTrans tag passed in directly, e.g. "hin_Deva"
    for iso, tag in ISO_TO_INDICTRANS.items():
        if tag.lower() == raw:
            return iso
    base = raw.split("-")[0]
    if base in ISO_TO_INDICTRANS:
        return base
    if base in _ISO_ALIASES:
        return _ISO_ALIASES[base]
    return ""


def map_iso_to_codes(iso_code: str, default: str = "en") -> tuple[str, str, str]:
    """
    Return (iso, tesseract, indictrans).

    v2.2: unknown languages now default to ENGLISH (identity passthrough)
    rather than being silently mislabelled as Hindi.
    """
    iso = normalize_iso(iso_code)
    if not iso:
        if iso_code:
            logger.warning(
                f"Unsupported language code '{iso_code}' — defaulting to '{default}'"
            )
        iso = default
    return iso, ISO_TO_TESSERACT[iso], ISO_TO_INDICTRANS[iso]


def supported_languages() -> list[dict]:
    """For the frontend's language dropdown on upload."""
    names = {
        "as": "Assamese", "bn": "Bengali", "brx": "Bodo", "doi": "Dogri",
        "gu": "Gujarati", "hi": "Hindi", "kn": "Kannada", "ks": "Kashmiri",
        "kok": "Konkani", "mai": "Maithili", "ml": "Malayalam",
        "mni": "Manipuri", "mr": "Marathi", "ne": "Nepali", "or": "Odia",
        "pa": "Punjabi", "sa": "Sanskrit", "sat": "Santali", "sd": "Sindhi",
        "ta": "Tamil", "te": "Telugu", "ur": "Urdu", "en": "English",
    }
    return [
        {
            "iso": iso,
            "name": names.get(iso, iso),
            "tesseract": ISO_TO_TESSERACT[iso],
            "indictrans": ISO_TO_INDICTRANS[iso],
        }
        for iso in sorted(ISO_TO_INDICTRANS, key=lambda k: names.get(k, k))
    ]


class LanguageDetector:

    def _result(self, iso: str, confidence: float, method: str,
                scripts: list[str] | None = None, script: str = "") -> DetectionResult:
        iso, tess, indic = map_iso_to_codes(iso)
        return DetectionResult(
            language=iso,
            tesseract_code=tess,
            indictrans_code=indic,
            confidence=confidence,
            method=method,
            is_english=(iso == "en"),
            scripts_found=scripts or [],
            script=script,
        )

    def detect(self, text: str) -> DetectionResult:
        if not text or len(text.strip()) < 10:
            return self._result("en", 0.3, "fallback", ["LATIN"], "LATIN")

        script_counts = _detect_scripts(text)
        total = sum(script_counts.values())
        scripts_found = [s for s, _ in script_counts.most_common()]

        if total == 0:
            return self._result("en", 0.5, "fallback", [], "")

        dominant_script, dominant_count = script_counts.most_common(1)[0]
        dominant_ratio = dominant_count / total

        # ---- Primary: script-based detection (most reliable for Indic OCR) ----
        if dominant_script in SCRIPT_TO_ISO and dominant_ratio > 0.3:
            iso = _disambiguate_script(dominant_script, text)
            latin_ratio = script_counts.get("LATIN", 0) / total

            if dominant_script == "LATIN":
                # Latin script — could be English or romanised Indic; ask langdetect
                iso = self._statistical_iso(text, default="en")
                method = "script+statistical"
            else:
                method = "mixed" if latin_ratio > 0.2 else "script"

            return self._result(
                iso,
                round(min(dominant_ratio + 0.2, 1.0), 2),
                method,
                scripts_found,
                dominant_script,
            )

        # ---- Fallback: statistical ----
        iso = self._statistical_iso(text, default="en")
        return self._result(iso, 0.85, "statistical", scripts_found, dominant_script)

    def _statistical_iso(self, text: str, default: str = "en") -> str:
        try:
            candidates = detect_langs(text)
            for cand in candidates:
                iso = normalize_iso(cand.lang)
                if iso:
                    return iso
            logger.info(
                f"langdetect returned unsupported languages "
                f"{[c.lang for c in candidates]} — using '{default}'"
            )
        except Exception as e:
            logger.warning(f"Statistical detection failed: {e}")
        return default

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
            script="",
        )
