# ==============================================================================
# CrimeNetX AI Service Dockerfile
# Stack: Python 3.11 + Tesseract v5 + IndicTrans2 + GLiNER + spaCy + Splink
# ==============================================================================

FROM python:3.11-slim

# Prevent Python from writing .pyc files and enable unbuffered logging
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HUB_DISABLE_SYMLINKS_WARNING=1

WORKDIR /app

# ── 1. System dependencies ───────────────────────────────────────────────────
# Tesseract OCR + Indian Language Packs + Poppler PDF utilities + Build tools
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

# ── 2. Python dependencies ───────────────────────────────────────────────────
COPY requirements.txt .

RUN pip install --upgrade pip setuptools wheel

RUN pip install --no-cache-dir -r requirements.txt

# ── 3. spaCy English model ───────────────────────────────────────────────────
RUN python -m spacy download en_core_web_sm

# ── 4. Pre-download IndicTrans2 Neural Translation Model (~800MB) ─────────────
ARG HF_TOKEN
RUN python -c "\
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM; \
model='ai4bharat/indictrans2-indic-en-dist-200M'; \
AutoTokenizer.from_pretrained(model, token='$HF_TOKEN', trust_remote_code=True); \
AutoModelForSeq2SeqLM.from_pretrained(model, token='$HF_TOKEN', trust_remote_code=True)"

# ── 5. Pre-download GLiNER Zero-Shot NER Model (~830MB) ─────────────────────
ARG GLINER_MODEL="urchade/gliner_medium-v2.1"
RUN python -c "\
from gliner import GLiNER; \
GLiNER.from_pretrained('$GLINER_MODEL')"

# ── 6. Copy Application Source Code ──────────────────────────────────────────
# Placed AFTER model pre-downloads so code edits don't trigger model re-downloads!
COPY . .

# Ensure storage directories exist
RUN mkdir -p data/raw_texts data/generated app/generated_dossiers

EXPOSE 8000

# ── 7. Start FastAPI ─────────────────────────────────────────────────────────
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]