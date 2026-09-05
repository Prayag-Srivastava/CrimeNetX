from app.services.language_detector import LanguageDetector
from app.services.translator import TranslatorService

text = "प्रथम सूचना रिपोर्ट थाना शिवाजीनगर पुणे। आरोपी रवि जाधव है।"

detector = LanguageDetector()
det = detector.detect(text)

print("=== LANGUAGE DETECTOR ===")
print(f"ISO           : {det.language}")
print(f"Tesseract     : {det.tesseract_code}")
print(f"IndicTrans tag: {det.indictrans_code}")  # should be hin_Deva
print(f"Method        : {det.method}")

translator = TranslatorService()
out = translator.translate(
    text,
    source_lang=det.language,
    source_indictrans_code=det.indictrans_code,
)

print("\n=== TRANSLATION ===")
print(f"Success       : {out.success}")
print(f"Was translated: {out.was_translated}")
print(f"Src tag used  : {out.source_indictrans_code}")
print(f"Error         : {out.error}")
print(f"Output        : {out.translated_text}")