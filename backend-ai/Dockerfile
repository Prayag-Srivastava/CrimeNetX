# ==============================================================================
# CrimeNetX AI Service Dockerfile
# Tesseract + IndicTrans2 + GLiNER-relex (+ optional plain GLiNER) + spaCy + Splink
# ==============================================================================

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HUB_DISABLE_SYMLINKS_WARNING=1 \
    TRANSFORMERS_VERBOSITY=error

WORKDIR /app

# ── 1. System deps ───────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    tesseract-ocr \
    tesseract-ocr-hin \
    tesseract-ocr-mar \
    tesseract-ocr-tam \
    tesseract-ocr-tel \
    tesseract-ocr-ben \
    tesseract-ocr-guj \
    tesseract-ocr-kan \
    tesseract-ocr-mal \
    tesseract-ocr-urd \
    tesseract-ocr-eng \
    poppler-utils \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# ── 2. Python deps ───────────────────────────────────────────────────────────
COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt

# ── 3. spaCy fallback model ──────────────────────────────────────────────────
RUN python -m spacy download en_core_web_sm

# ── 4. IndicTrans2 (translation) ─────────────────────────────────────────────
ARG HF_TOKEN=
RUN python -c "\
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM; \
m='ai4bharat/indictrans2-indic-en-dist-200M'; \
kw={'trust_remote_code': True}; \
import os; \
t=os.environ.get('HF_TOKEN') or '$HF_TOKEN'; \
kw['token']=t if t else None; \
AutoTokenizer.from_pretrained(m, **{k:v for k,v in kw.items() if v is not None}); \
AutoModelForSeq2SeqLM.from_pretrained(m, **{k:v for k,v in kw.items() if v is not None}); \
print('IndicTrans2 cached OK')"

# ── 5. GLiNER-relex (PRIMARY: joint NER + relations) ─────────────────────────
ARG GLINER_RELEX_MODEL=knowledgator/gliner-relex-large-v0.5
RUN python -c "\
from gliner import GLiNER; \
GLiNER.from_pretrained('$GLINER_RELEX_MODEL'); \
print('GLiNER-relex cached OK')"

# ── 6. Optional plain GLiNER (entity-only fallback) ──────────────────────────
# Comment out this block if you want a smaller image and only use relex.
ARG GLINER_MODEL=urchade/gliner_medium-v2.1
RUN python -c "\
from gliner import GLiNER; \
GLiNER.from_pretrained('$GLINER_MODEL'); \
print('GLiNER medium cached OK')"

# ── 7. App code (AFTER models so code edits don't redownload) ────────────────
COPY . .
RUN mkdir -p data/raw_texts data/generated app/generated_dossiers

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]