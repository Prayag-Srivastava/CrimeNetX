"""
CrimeNetX — Stage 2: IndicTrans2 Translation (v2.2)
====================================================
Translates ANY of the 22 scheduled Indian languages -> English.

Accepts either:
  - ISO code:       "hi", "ta", "sat", "mni", "or"
  - IndicTrans code: "hin_Deva", "tam_Taml", "sat_Olck", "mni_Beng"

WHAT CHANGED IN v2.2
--------------------
CRITICAL FIX — text truncation:
    The old loop did `chunk = para[:400]` and translated only that slice,
    silently DISCARDING everything past character 400 of every paragraph.
    On a typical multi-paragraph FIR this threw away 60-80% of the
    narrative — including most suspect names, phone numbers and the money
    trail — before spaCy ever saw the text. This was the single biggest
    cause of "entities aren't coming that good".

    Now the text is split into sentence-aware chunks of <=400 chars and
    EVERY chunk is translated, then rejoined. Nothing is dropped.

Other fixes:
  * Sentence splitter understands the Devanagari danda "।" (Hindi FIRs
    use it instead of a full stop) — previously long Hindi paragraphs
    could not be split cleanly at all.
  * Removed the duplicated/unreachable `except Exception` tokenizer branch
    and fixed its indentation.
  * Batched generation with a progress log so long FIRs are observable.
  * `_load_model()` no longer double-imports torch inside an f-expression.
  * Paragraph structure is preserved (chunks are regrouped per paragraph)
    so `text.split("\\n\\n")` downstream (co-occurrence relations) still works.
"""

import logging
import re
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Optional


@contextmanager
def _nullcontext():
    yield

from app.config import INDICTRANS_MODEL_NAME, TRANSLATION_DEVICE, TRANSLATION_MAX_LENGTH
from app.services.language_detector import (
    ISO_TO_INDICTRANS,
    map_iso_to_codes,
    normalize_iso,
)

logger = logging.getLogger(__name__)

# Max characters per translation chunk. IndicTrans2 degrades on very long
# inputs, so we chunk — but we translate ALL chunks, not just the first.
CHUNK_CHAR_LIMIT = 400

# Sentences translated per model.generate() call. IndicTrans2 is a seq2seq
# model that batches well; 8 keeps CPU memory modest while cutting the number
# of forward passes ~8x versus the old one-chunk-at-a-time loop.
BATCH_SIZE = 8

# Sentence boundaries across ALL supported scripts:
#   ।  ॥   Devanagari/Bengali/Gujarati/Odia/Punjabi danda + double danda
#   ۔  ؟   Urdu/Sindhi/Kashmiri full stop and question mark
#   ᱾  ᱿   Ol Chiki (Santali) mucaad + double mucaad
#   . ! ?  Latin
_SENTENCE_SPLIT = re.compile(r'(?<=[।॥۔؟᱾᱿.!?])\s+')


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


def _chunk_paragraph(para: str, limit: int = CHUNK_CHAR_LIMIT) -> list[str]:
    """Split one paragraph into <=limit char pieces at sentence boundaries."""
    para = para.strip()
    if not para:
        return []
    if len(para) <= limit:
        return [para]

    chunks: list[str] = []
    buf = ""

    for sent in _SENTENCE_SPLIT.split(para):
        sent = sent.strip()
        if not sent:
            continue

        # A single sentence longer than the limit — hard-wrap it on whitespace
        if len(sent) > limit:
            if buf:
                chunks.append(buf.strip())
                buf = ""
            words = sent.split()
            piece = ""
            for w in words:
                if len(piece) + len(w) + 1 > limit:
                    if piece:
                        chunks.append(piece.strip())
                    piece = w
                else:
                    piece = f"{piece} {w}".strip()
            if piece:
                buf = piece
            continue

        if len(buf) + len(sent) + 1 > limit:
            chunks.append(buf.strip())
            buf = sent
        else:
            buf = f"{buf} {sent}".strip()

    if buf.strip():
        chunks.append(buf.strip())

    return [c for c in chunks if c]


class TranslatorService:
    def __init__(self):
        self._model = None
        self._tokenizer = None
        self._processor = None
        self._proc_mode = "none"
        self._device = None
        self._model_name = INDICTRANS_MODEL_NAME

    def _load_model(self):
        if self._model is not None:
            return
        try:
            import torch
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

            if TRANSLATION_DEVICE == "auto":
                self._device = "cuda" if torch.cuda.is_available() else "cpu"
            else:
                self._device = TRANSLATION_DEVICE

            logger.info(f"Loading IndicTrans2 ({self._model_name}) on {self._device}")

            self._tokenizer = AutoTokenizer.from_pretrained(
                self._model_name, trust_remote_code=True
            )
            self._model = AutoModelForSeq2SeqLM.from_pretrained(
                self._model_name, trust_remote_code=True
            ).to(self._device)
            self._model.eval()

            # ----------------------------------------------------------
            # IndicProcessor — REQUIRED for IndicTrans2.
            #
            # This is what was causing "'NoneType' object has no attribute
            # 'shape'": the IndicTrans2 tokenizer does NOT accept src_lang /
            # tgt_lang kwargs the way NLLB/M2M100 do. It silently ignores
            # them and returns input_ids=None, which explodes inside
            # model.generate(). It never raises TypeError, so the old
            # `except TypeError` fallback never fired.
            #
            # IndicTrans2 requires sentences to be pre-processed (script
            # normalisation + "src_tag tgt_tag sentence" prefixing) by
            # IndicProcessor, then post-processed to detokenize/restore
            # entities after generation.
            # ----------------------------------------------------------
            try:
                from IndicTransToolkit.processor import IndicProcessor
                self._processor = IndicProcessor(inference=True)
                self._proc_mode = "toolkit"
                logger.info("IndicProcessor (IndicTransToolkit) ready")
            except ImportError:
                try:
                    from IndicTransToolkit import IndicProcessor  # older layout
                    self._processor = IndicProcessor(inference=True)
                    self._proc_mode = "toolkit"
                    logger.info("IndicProcessor (IndicTransToolkit legacy) ready")
                except ImportError:
                    self._processor = None
                    self._proc_mode = "manual"
                    logger.warning(
                        "IndicTransToolkit not installed — using manual tag "
                        "prefixing. Quality will be lower and entity "
                        "placeholders are not restored. "
                        "Install with: pip install IndicTransToolkit"
                    )

            logger.info(f"IndicTrans2 ready (preprocess={self._proc_mode})")
        except Exception as e:
            logger.error(f"IndicTrans2 load failed: {e}")
            self._model = None
            self._tokenizer = None
            self._processor = None

    def _resolve_codes(self, source_lang: str) -> tuple[str, str]:
        """
        Accepts any of the 22 IndicTrans2 languages as:
          - ISO code:        "hi", "ta", "sat", "mni"
          - IndicTrans tag:  "hin_Deva", "tam_Taml", "sat_Olck"
        Returns: (iso_code, indictrans_code)

        v2.2: unknown codes resolve to English (identity) instead of being
        silently mislabelled as Hindi, which used to corrupt translation of
        any language outside the old 11-language table.
        """
        val = (source_lang or "").strip()

        # Already a valid IndicTrans tag?
        if "_" in val:
            for iso_key, tag in ISO_TO_INDICTRANS.items():
                if tag.lower() == val.lower():
                    return iso_key, tag

        iso = normalize_iso(val)
        if not iso:
            logger.warning(
                f"Unknown source language '{source_lang}' — treating as English "
                f"(no translation). Pass a valid ISO or IndicTrans2 code."
            )
            return "en", "eng_Latn"

        iso, _, indic = map_iso_to_codes(iso)
        return iso, indic

    def _translate_batch(
        self,
        batch: list[str],
        src_code: str,
        tgt_code: str,
    ) -> list[str]:
        """
        Translate a batch of sentences the way IndicTrans2 actually expects.

        Correct flow:
            IndicProcessor.preprocess_batch(...)   # normalise + add lang tags
            tokenizer(...)                          # plain call, NO lang kwargs
            model.generate(...)
            tokenizer.batch_decode(...)
            IndicProcessor.postprocess_batch(...)   # detokenize + restore entities
        """
        import torch

        # ---- preprocess ----
        if self._proc_mode == "toolkit" and self._processor is not None:
            prepared = self._processor.preprocess_batch(
                batch, src_lang=src_code, tgt_lang=tgt_code
            )
        else:
            # Manual fallback: IndicTrans2 expects the two language tags
            # prefixed to each sentence.
            prepared = [f"{src_code} {tgt_code} {s}" for s in batch]

        # ---- tokenize (NO src_lang/tgt_lang kwargs — that returns None) ----
        inputs = self._tokenizer(
            prepared,
            truncation=True,
            padding="longest",
            max_length=TRANSLATION_MAX_LENGTH,
            return_tensors="pt",
            return_attention_mask=True,
        )

        if inputs.get("input_ids") is None:
            raise RuntimeError(
                "Tokenizer returned input_ids=None — IndicTrans2 preprocessing "
                "did not produce valid input. Install IndicTransToolkit."
            )

        inputs = {k: v.to(self._device) for k, v in inputs.items() if v is not None}

        # ---- generate ----
        with torch.no_grad():
            generated = self._model.generate(
                **inputs,
                max_length=TRANSLATION_MAX_LENGTH,
                num_beams=5,
                num_return_sequences=1,
                early_stopping=True,
                use_cache=True,
            )

        # ---- decode ----
        with self._tokenizer.as_target_tokenizer() if hasattr(
            self._tokenizer, "as_target_tokenizer"
        ) else _nullcontext():
            decoded = self._tokenizer.batch_decode(
                generated.detach().cpu().tolist(),
                skip_special_tokens=True,
                clean_up_tokenization_spaces=True,
            )

        # ---- postprocess (restores entities/placeholders) ----
        if self._proc_mode == "toolkit" and self._processor is not None:
            decoded = self._processor.postprocess_batch(decoded, lang=tgt_code)

        return [d.strip() for d in decoded]

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

        # Identity path — already English or too short to matter
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

            # Set language properties if the tokenizer supports them
            if hasattr(self._tokenizer, "src_lang"):
                self._tokenizer.src_lang = src_code
            if hasattr(self._tokenizer, "tgt_lang"):
                self._tokenizer.tgt_lang = tgt_code

            paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()] or [text.strip()]

            # ------------------------------------------------------------
            # FIX: chunk EVERY paragraph fully instead of `para[:400]`.
            # We keep track of which paragraph each chunk belongs to so the
            # blank-line structure survives translation.
            # ------------------------------------------------------------
            chunks: list[str] = []
            chunk_para_index: list[int] = []

            for p_idx, para in enumerate(paragraphs):
                for piece in _chunk_paragraph(para, CHUNK_CHAR_LIMIT):
                    chunks.append(piece)
                    chunk_para_index.append(p_idx)

            if not chunks:
                raise RuntimeError("No translatable content after chunking")

            dropped = len(text) - sum(len(c) for c in chunks)
            logger.info(
                f"Translating {len(chunks)} chunk(s) from {len(paragraphs)} paragraph(s) "
                f"({len(text)} chars, ~{max(dropped, 0)} chars of whitespace/separators)"
            )

            translated_chunks: list[str] = []
            failed_chunks = 0

            for b_start in range(0, len(chunks), BATCH_SIZE):
                batch = chunks[b_start:b_start + BATCH_SIZE]
                try:
                    out = self._translate_batch(batch, src_code, tgt_code)
                    if len(out) != len(batch):
                        raise RuntimeError(
                            f"batch size mismatch: got {len(out)} for {len(batch)}"
                        )
                    translated_chunks.extend(out)
                except Exception as batch_err:
                    logger.warning(
                        f"Batch {b_start // BATCH_SIZE + 1} failed "
                        f"({len(batch)} chunks): {batch_err}"
                    )
                    # Retry one-by-one so a single bad chunk doesn't lose the batch
                    for chunk in batch:
                        try:
                            translated_chunks.extend(
                                self._translate_batch([chunk], src_code, tgt_code)
                            )
                        except Exception as chunk_err:
                            failed_chunks += 1
                            logger.warning(f"  chunk failed: {chunk_err}")
                            translated_chunks.append(chunk)

                done = min(b_start + BATCH_SIZE, len(chunks))
                logger.info(f"  translated {done}/{len(chunks)} chunks")

            # Regroup chunks back into their original paragraphs
            grouped: dict[int, list[str]] = {}
            for p_idx, piece in zip(chunk_para_index, translated_chunks):
                grouped.setdefault(p_idx, []).append(piece)

            rebuilt = [
                " ".join(grouped[i]).strip()
                for i in sorted(grouped)
                if " ".join(grouped[i]).strip()
            ]
            full = "\n\n".join(rebuilt).strip()

            if not full:
                raise RuntimeError("Empty translation output")

            if failed_chunks:
                logger.warning(
                    f"{failed_chunks}/{len(chunks)} chunks fell back to source text"
                )

            logger.info(
                f"Translation complete: {len(text)} chars {src_code} -> "
                f"{len(full)} chars eng_Latn"
            )

            return TranslationResult(
                original_text=text,
                translated_text=full,
                source_language=iso,
                source_indictrans_code=src_code,
                target_language="en",
                model_used=self._model_name,
                was_translated=True,
                success=failed_chunks < len(chunks),
                error=(
                    f"{failed_chunks} of {len(chunks)} chunks failed"
                    if failed_chunks else None
                ),
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
