FROM python:3.11-slim

WORKDIR /app

# ── System dependencies for Tesseract OCR + PDF processing ──
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-hin \
    tesseract-ocr-mar \
    tesseract-ocr-tam \
    tesseract-ocr-tel \
    tesseract-ocr-ben \
    tesseract-ocr-guj \
    tesseract-ocr-kan \
    tesseract-ocr-mal \
    tesseract-ocr-pun \
    tesseract-ocr-urd \
    tesseract-ocr-eng \
    poppler-utils \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# ── Python dependencies ──
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Download spaCy model ──
RUN python -m spacy download en_core_web_sm

# ── Pre-download IndicTrans2 model (cached in Docker layer) ──
RUN python -c "from transformers import AutoModelForSeq2SeqLM, AutoTokenizer; \
    AutoTokenizer.from_pretrained('ai4bharat/indictrans2-indic-en-dist-200M', trust_remote_code=True); \
    AutoModelForSeq2SeqLM.from_pretrained('ai4bharat/indictrans2-indic-en-dist-200M', trust_remote_code=True)"

# ── Copy application ──
COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]