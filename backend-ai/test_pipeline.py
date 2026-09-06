# backend-ai/test_pipeline.py
import json
import logging
from pathlib import Path
from app.services.pipeline import ForensicPipeline
def run_test():
    print("=" * 70)
    print("🚀 RUNNING END-TO-END FORENSIC PIPELINE TEST")
    print("=" * 70)

    mock_fir_dir = Path(
        r"C:\Users\sahuv\OneDrive\Desktop\sih'26\data\generated\mock_firs"
    )

    mock_fir_path = mock_fir_dir / "hindi_fir_test_aliases.pdf"

    # If exact file doesn't exist, find any PDF in the folder
    if not mock_fir_path.exists():
        pdf_files = list(mock_fir_dir.glob("*.pdf"))

        if pdf_files:
            mock_fir_path = pdf_files[0]
        else:
            print(f"⚠️ No FIR PDF found in {mock_fir_dir}")
            print("Please put a PDF in that folder.")
            return

   

    print(f"📄 Testing Document: {mock_fir_path.name}")
    print("⏳ Processing through 5 stages (OCR → Translate → NER → Resolve → Relationships)...")
    print("-" * 70)

    # Initialize the pipeline
    pipeline = ForensicPipeline()

    # Process the document
    result = pipeline.process_document(
    file_path=mock_fir_path,
    case_id="PUN-2024-0118",
    document_type="FIR",
    force_language="hi",   # investigator choice: hi / mr / en / ta / te ...
)

    print("\n" + "=" * 70)
    print("📊 PIPELINE RESULTS SUMMARY")
    print("=" * 70)
    print(f"✅ Success Status      : {result.success}")
    print(f"⏱️  Total Time Elapsed  : {result.processing_time_seconds} seconds")
    print(f"🆔 Document ID         : {result.document_id}")
    print(f"🔒 Original File Hash  : {result.original_file_hash[:20]}...")
    print(f"🔒 Raw OCR Text Hash   : {result.ocr_text_hash[:20]}...")
    print(f"🔒 Translated Text Hash: {result.translated_text_hash[:20]}...")
    
    print("\n--- STAGE 1: OCR ---")
    print(f"Language Used    : {result.ocr_language}")
    print(f"Confidence Score : {result.ocr_confidence}%")
    print(f"Extracted Sample : {result.ocr_text[:150]}...")

    print("\n--- STAGE 2: TRANSLATION ---")
    print(f"Source Language  : {result.source_language}")
    print(f"Was Translated?  : {result.was_translated}")
    print(f"Model Used       : {result.translation_model}")
    print(f"English Sample   : {result.translated_text[:150]}...")

    print("\n--- STAGE 3: SPA CY NER (ENTITIES WITH SPANS) ---")
    print(f"Total Extracted  : {len(result.entities)}")
    for ent in result.entities[:10]:  # Show first 10
        print(f"  • [{ent['label']}] {ent['text']} (chars {ent['start']}-{ent['end']})")

    print("\n--- STAGE 4: SPLINK ENTITY RESOLUTION ---")
    if result.resolution_report:
        print(f"Total Entities Compared : {result.resolution_report.total_entities}")
        print(f"Automatic Merges        : {result.resolution_report.merges}")
        print(f"Human Review Flags      : {result.resolution_report.reviews}")
    else:
        print("No resolution report generated.")

    print("\n--- STAGE 5: RELATIONSHIPS ---")
    print(f"Total Relationships: {len(result.relationships)}")
    for rel in result.relationships:
        print(f"  • {rel.get('source')} ──[{rel.get('relation')}]──> {rel.get('target')}")
        print(f"    Proof: \"{rel.get('evidence')[:80]}...\"")

    if result.stage_errors:
        print("\n⚠️ STAGE WARNINGS/ERRORS:")
        for err in result.stage_errors:
            print(f"  - {err}")

    print("=" * 70)

if __name__ == "__main__":
    run_test()