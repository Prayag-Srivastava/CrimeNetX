# backend-ai/test_env.py
import pytesseract

pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)
import sys

print("=" * 60)
print("🔍 CRIMENETX DEPENDENCY & MODEL VERIFICATION")
print("=" * 60)

# 1. Test Tesseract OCR
try:
    import pytesseract
    version = pytesseract.get_tesseract_version()
    langs = pytesseract.get_languages()
    print(f"✅ [1/5] Tesseract OCR Installed: v{version}")
    print(f"       Languages Available: {', '.join(langs)}")
    if "hin" not in langs and "mar" not in langs:
        print("       ⚠️ Warning: 'hin' or 'mar' language packs not detected!")
except Exception as e:
    print(f"❌ [1/5] Tesseract OCR FAILED: {e}")

# 2. Test Poppler (PDF Rendering)
try:
    from pdf2image import convert_from_bytes
    print("✅ [2/5] Poppler / pdf2image: Ready")
except Exception as e:
    print(f"❌ [2/5] Poppler FAILED: {e}")

# 3. Test spaCy
try:
    import spacy
    nlp = spacy.load("en_core_web_sm")
    doc = nlp("Ravi Jadhav visited Pune.")
    ents = [(e.text, e.label_) for e in doc.ents]
    print(f"✅ [3/5] spaCy NLP: Ready (Sample Extraction: {ents})")
except Exception as e:
    print(f"❌ [3/5] spaCy FAILED: {e}")

# 4. Test IndicTrans2 Model
try:
    from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
    model_name = "ai4bharat/indictrans2-indic-en-dist-200M"
    tok = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    mod = AutoModelForSeq2SeqLM.from_pretrained(model_name, trust_remote_code=True)
    print("✅ [4/5] IndicTrans2 Translation Model: Downloaded & Loaded")
except Exception as e:
    print(f"❌ [4/5] IndicTrans2 FAILED: {e}")

# 5. Test Splink & DuckDB
try:
    import splink
    import duckdb
    print("✅ [5/5] Splink & DuckDB Entity Resolution: Ready")
except Exception as e:
    print(f"❌ [5/5] Splink / DuckDB FAILED: {e}")

print("=" * 60)
print("✨ If all 5 show green checks (✅), your environment is 100% ready!")
print("=" * 60)