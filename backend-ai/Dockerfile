FROM python:3.11-slim

WORKDIR /app

# ── System dependencies ─────────────────────────────────────────────
# Tesseract OCR + PDF processing + native compilation for
# IndicTransToolkit
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
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

# ── Python dependencies ─────────────────────────────────────────────
COPY requirements.txt .

RUN pip install --upgrade pip setuptools wheel

RUN pip install --no-cache-dir -r requirements.txt

# ── spaCy English model ─────────────────────────────────────────────
RUN python -m spacy download en_core_web_sm

# ── Pre-download IndicTrans2 model ──────────────────────────────────
# Pass HF_TOKEN during docker build if required by your setup.
ARG HF_TOKEN

RUN python -c "\
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM; \
model='ai4bharat/indictrans2-indic-en-dist-200M'; \
AutoTokenizer.from_pretrained(model, token='$HF_TOKEN', trust_remote_code=True); \
AutoModelForSeq2SeqLM.from_pretrained(model, token='$HF_TOKEN', trust_remote_code=True)"

# ── Copy application ────────────────────────────────────────────────
COPY . .

EXPOSE 8000

# ── Start FastAPI ───────────────────────────────────────────────────
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]