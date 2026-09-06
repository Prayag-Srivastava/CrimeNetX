"""
CrimeNetX — Stage 2: IndicTrans2 Translation
=============================================
Accepts either:
  - ISO code: "hi"
  - IndicTrans code: "hin_Deva"
"""

import logging
from dataclasses import dataclass
from typing import Optional

from app.config import INDICTRANS_MODEL_NAME, TRANSLATION_DEVICE, TRANSLATION_MAX_LENGTH
from app.services.language_detector import ISO_TO_INDICTRANS, map_iso_to_codes

logger = logging.getLogger(__name__)


@dataclass
class TranslationResult:
    original_text: str
    translated_text: str
    source_language: str
    source_indictrans_code: str
    target_language: str
    model_used: str
    was_translated: bool
    success: bool = True
    error: Optional[str] = None


class TranslatorService:
    def __init__(self):
        self._model = None
        self._tokenizer = None
        self._device = None
        self._model_name = INDICTRANS_MODEL_NAME

    def _load_model(self):
        if self._model is not None:
            return
        try:
            import torch
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

            self._device = (
                "cuda" if TRANSLATION_DEVICE == "auto" and __import__("torch").cuda.is_available()
                else (TRANSLATION_DEVICE if TRANSLATION_DEVICE != "auto" else "cpu")
            )
            logger.info(f"Loading IndicTrans2 on {self._device}")

            self._tokenizer = AutoTokenizer.from_pretrained(
                self._model_name, trust_remote_code=True
            )
            self._model = AutoModelForSeq2SeqLM.from_pretrained(
                self._model_name, trust_remote_code=True
            ).to(self._device)
            self._model.eval()
            logger.info("IndicTrans2 ready")
        except Exception as e:
            logger.error(f"IndicTrans2 load failed: {e}")
            self._model = None

    def _resolve_codes(self, source_lang: str) -> tuple[str, str]:
        """
        source_lang can be:
          - "hi"
          - "hin_Deva"
        Returns: (iso_code, indictrans_code)
        """
        val = (source_lang or "hi").strip()

        # Already an IndicTrans tag?
        if "_" in val and val in ISO_TO_INDICTRANS.values():
            iso = next((k for k, v in ISO_TO_INDICTRANS.items() if v == val), "hi")
            return iso, val

        iso, _, indic = map_iso_to_codes(val)
        return iso, indic

    def translate(
        self,
        text: str,
        source_lang: str = "hi",
        source_indictrans_code: Optional[str] = None,
    ) -> TranslationResult:
        if source_indictrans_code:
            iso, src_code = self._resolve_codes(source_indictrans_code)
        else:
            iso, src_code = self._resolve_codes(source_lang)

        tgt_code = "eng_Latn"

        if iso == "en" or not text or len(text.strip()) < 5:
            return TranslationResult(
                original_text=text,
                translated_text=text,
                source_language=iso,
                source_indictrans_code=src_code,
                target_language="en",
                model_used="identity",
                was_translated=False,
            )

        self._load_model()
        if self._model is None or self._tokenizer is None:
            return TranslationResult(
                original_text=text,
                translated_text=text,
                source_language=iso,
                source_indictrans_code=src_code,
                target_language="en",
                model_used="none",
                was_translated=False,
                success=False,
                error="IndicTrans2 model not available",
            )

        try:
            import torch

            # Set language properties if tokenizer supports them
            if hasattr(self._tokenizer, "src_lang"):
                self._tokenizer.src_lang = src_code
            if hasattr(self._tokenizer, "tgt_lang"):
                self._tokenizer.tgt_lang = tgt_code

            paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()] or [text.strip()]
            translated = []

            for para in paragraphs:
                chunk = para[:400]

                # Best format for IndicTrans2 custom tokenizer:
                # put BOTH tags in the string when src_lang/tgt_lang kwargs fail
                tagged = f"{src_code} {tgt_code} {chunk}"

                try:
                    inputs = self._tokenizer(
                        chunk,
                        src_lang=src_code,
                        tgt_lang=tgt_code,
                        return_tensors="pt",
                        padding=True,
                        truncation=True,
                        max_length=TRANSLATION_MAX_LENGTH,
                    )
                except TypeError:
                    # Older/custom tokenizer path
                    inputs = self._tokenizer(
                    tagged,
                    return_tensors="pt",
                    padding=True,
                    truncation=True,
                    max_length=TRANSLATION_MAX_LENGTH,
                )
                except Exception:
                    inputs = self._tokenizer(
                        tagged,
                        return_tensors="pt",
                        padding=True,
                        truncation=True,
                        max_length=TRANSLATION_MAX_LENGTH,
                    )

                inputs = {k: v.to(self._device) for k, v in inputs.items()}

                forced_bos = None
                if hasattr(self._tokenizer, "lang_code_to_id"):
                    forced_bos = self._tokenizer.lang_code_to_id.get(tgt_code)
                elif hasattr(self._tokenizer, "convert_tokens_to_ids"):
                    try:
                        forced_bos = self._tokenizer.convert_tokens_to_ids(tgt_code)
                    except Exception:
                        forced_bos = None

                gen_kwargs = {
                    "max_new_tokens": TRANSLATION_MAX_LENGTH,
                    "num_beams": 3,
                    "early_stopping": True,
                }
                if isinstance(forced_bos, int) and forced_bos > 0:
                    gen_kwargs["forced_bos_token_id"] = forced_bos

                with torch.no_grad():
                    out = self._model.generate(**inputs, **gen_kwargs)

                decoded = self._tokenizer.batch_decode(out, skip_special_tokens=True)[0]
                translated.append(decoded.strip())

            full = "\n\n".join(translated).strip()
            if not full:
                raise RuntimeError("Empty translation output")

            return TranslationResult(
                original_text=text,
                translated_text=full,
                source_language=iso,
                source_indictrans_code=src_code,
                target_language="en",
                model_used=self._model_name,
                was_translated=True,
                success=True,
            )

        except Exception as e:
            logger.error(f"Translation error: {e}")
            return TranslationResult(
                original_text=text,
                translated_text=text,
                source_language=iso,
                source_indictrans_code=src_code,
                target_language="en",
                model_used=self._model_name,
                was_translated=False,
                success=False,
                error=str(e),
            )


Translator = TranslatorService