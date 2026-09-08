"""CrimeNetX IndicTrans2 translation service.

The public API is intentionally unchanged:
    TranslatorService.translate(text, source_lang="hi",
                                source_indictrans_code=None)
    -> TranslationResult
"""

import logging
import re
from dataclasses import dataclass
from typing import Optional

from app.config import (
    INDICTRANS_MODEL_NAME,
    TRANSLATION_DEVICE,
    TRANSLATION_MAX_LENGTH,
)
from app.services.language_detector import (
    ISO_TO_INDICTRANS,
    map_iso_to_codes,
    normalize_iso,
)

logger = logging.getLogger(__name__)

CHUNK_CHAR_LIMIT = 400
BATCH_SIZE = 8
TARGET_CODE = "eng_Latn"

_SENTENCE_SPLIT = re.compile(r"(?<=[।॥۔؟᱾᱿.!?])\s+")


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


def _chunk_paragraph(text: str, limit: int = CHUNK_CHAR_LIMIT) -> list[str]:
    """Split text without dropping content."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= limit:
        return [text]

    chunks: list[str] = []
    current = ""

    for sentence in _SENTENCE_SPLIT.split(text):
        sentence = sentence.strip()
        if not sentence:
            continue

        if len(sentence) > limit:
            if current:
                chunks.append(current)
                current = ""

            words = sentence.split()
            piece = ""

            for word in words:
                if len(word) > limit:
                    if piece:
                        chunks.append(piece)
                        piece = ""
                    chunks.extend(
                        word[i : i + limit]
                        for i in range(0, len(word), limit)
                    )
                    continue

                candidate = f"{piece} {word}".strip()
                if len(candidate) > limit:
                    if piece:
                        chunks.append(piece)
                    piece = word
                else:
                    piece = candidate

            if piece:
                current = piece
            continue

        candidate = f"{current} {sentence}".strip()
        if len(candidate) > limit:
            if current:
                chunks.append(current)
            current = sentence
        else:
            current = candidate

    if current:
        chunks.append(current)

    return chunks


class TranslatorService:
    def __init__(self):
        self._model = None
        self._tokenizer = None
        self._processor = None
        self._device = None
        self._model_name = INDICTRANS_MODEL_NAME

    def _load_model(self) -> None:
        """Load the official HF-compatible IndicTrans2 pipeline once."""
        if self._model is not None:
            return

        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        from IndicTransToolkit.processor import IndicProcessor

        self._device = (
            "cuda" if TRANSLATION_DEVICE == "auto" and torch.cuda.is_available()
            else "cpu" if TRANSLATION_DEVICE == "auto"
            else TRANSLATION_DEVICE
        )

        logger.info(
            "Loading IndicTrans2: model=%s device=%s",
            self._model_name,
            self._device,
        )

        try:
            self._tokenizer = AutoTokenizer.from_pretrained(
                self._model_name,
                trust_remote_code=True,
            )
            self._model = AutoModelForSeq2SeqLM.from_pretrained(
                self._model_name,
                trust_remote_code=True,
            ).to(self._device)
            self._model.eval()
            self._processor = IndicProcessor(inference=True)
        except Exception:
            self._model = None
            self._tokenizer = None
            self._processor = None
            self._device = None
            logger.exception("IndicTrans2 model loading failed")
            raise

    @staticmethod
    def _resolve_codes(source_lang: str) -> tuple[str, str]:
        """Use the existing language detector/mapping contract."""
        value = (source_lang or "").strip()

        if "_" in value:
            for iso, indic_code in ISO_TO_INDICTRANS.items():
                if indic_code.lower() == value.lower():
                    return iso, indic_code

        iso = normalize_iso(value)
        if not iso:
            logger.warning(
                "Unknown source language '%s'; treating as English",
                source_lang,
            )
            return "en", "eng_Latn"

        iso, _, indic_code = map_iso_to_codes(iso)
        return iso, indic_code

    def _translate_batch(
        self,
        texts: list[str],
        source_code: str,
    ) -> list[str]:
        """Official IndicTrans2 HF inference path."""
        import torch

        if not texts:
            return []

        if not self._model or not self._tokenizer or not self._processor:
            raise RuntimeError("IndicTrans2 is not loaded")

        prepared = self._processor.preprocess_batch(
            texts,
            src_lang=source_code,
            tgt_lang=TARGET_CODE,
        )

        inputs = self._tokenizer(
            prepared,
            truncation=True,
            padding="longest",
            max_length=TRANSLATION_MAX_LENGTH,
            return_tensors="pt",
            return_attention_mask=True,
        )

        inputs = {
            key: value.to(self._device)
            for key, value in inputs.items()
            if value is not None
        }

        with torch.no_grad():
            generated = self._model.generate(
                **inputs,
                use_cache=True,
                min_length=0,
                max_length=TRANSLATION_MAX_LENGTH,
                num_beams=5,
                num_return_sequences=1,
            )

        decoded = self._tokenizer.batch_decode(
            generated.detach().cpu(),
            skip_special_tokens=True,
            clean_up_tokenization_spaces=True,
        )

        return [
            text.strip()
            for text in self._processor.postprocess_batch(
                decoded,
                lang=TARGET_CODE,
            )
        ]

    def translate(
        self,
        text: str,
        source_lang: str = "hi",
        source_indictrans_code: Optional[str] = None,
    ) -> TranslationResult:
        """Translate Indic text to English without changing the app contract."""
        iso, source_code = self._resolve_codes(
            source_indictrans_code or source_lang
        )

        if iso == "en" or not text or len(text.strip()) < 5:
            return TranslationResult(
                original_text=text,
                translated_text=text,
                source_language=iso,
                source_indictrans_code=source_code,
                target_language="en",
                model_used="identity",
                was_translated=False,
            )

        try:
            self._load_model()

            paragraphs = [
                p.strip() for p in text.split("\n\n") if p.strip()
            ] or [text.strip()]

            chunks: list[str] = []
            paragraph_ids: list[int] = []

            for index, paragraph in enumerate(paragraphs):
                for chunk in _chunk_paragraph(paragraph):
                    chunks.append(chunk)
                    paragraph_ids.append(index)

            if not chunks:
                raise RuntimeError("No translatable content")

            translated: list[str] = []
            failed = 0

            for start in range(0, len(chunks), BATCH_SIZE):
                batch = chunks[start : start + BATCH_SIZE]

                try:
                    translated.extend(
                        self._translate_batch(batch, source_code)
                    )
                except Exception as batch_error:
                    logger.warning(
                        "Batch failed; retrying individually: %s",
                        batch_error,
                    )

                    for chunk in batch:
                        try:
                            translated.extend(
                                self._translate_batch([chunk], source_code)
                            )
                        except Exception as chunk_error:
                            failed += 1
                            logger.warning(
                                "Chunk failed: %s",
                                chunk_error,
                            )
                            translated.append(chunk)

            if len(translated) != len(chunks):
                raise RuntimeError(
                    "Translation count does not match chunk count"
                )

            grouped: dict[int, list[str]] = {}
            for paragraph_id, result in zip(paragraph_ids, translated):
                grouped.setdefault(paragraph_id, []).append(result)

            output = "\n\n".join(
                " ".join(grouped[index]).strip()
                for index in range(len(paragraphs))
                if index in grouped
            ).strip()

            if not output:
                raise RuntimeError("Empty translation output")

            return TranslationResult(
                original_text=text,
                translated_text=output,
                source_language=iso,
                source_indictrans_code=source_code,
                target_language="en",
                model_used=self._model_name,
                was_translated=True,
                success=failed < len(chunks),
                error=(
                    f"{failed} of {len(chunks)} chunks failed"
                    if failed
                    else None
                ),
            )

        except Exception as error:
            logger.exception("Translation failed")

            return TranslationResult(
                original_text=text,
                translated_text=text,
                source_language=iso,
                source_indictrans_code=source_code,
                target_language="en",
                model_used=self._model_name,
                was_translated=False,
                success=False,
                error=str(error),
            )


# Existing compatibility alias.
Translator = TranslatorService
