# ============================================================
# ADD THESE ENDPOINTS TO YOUR EXISTING routers/nlp.py
# ============================================================

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.services.pipeline import ForensicPipeline
from app.models.schemas import PipelineResponse, ProvenanceResponse, IntegrityCheckResponse
from app.utils.text_storage import TextStorage

router = APIRouter(prefix="/api/nlp", tags=["NLP Pipeline"])

# Initialize pipeline (lazy — models load on first request)
_pipeline = None

def get_pipeline():
    global _pipeline
    if _pipeline is None:
        _pipeline = ForensicPipeline()
    return _pipeline


@router.post("/process-document", response_model=PipelineResponse)
async def process_document(
    file: UploadFile = File(...),
    case_id: str = Form(...),
    document_type: str = Form("FIR"),
    force_language: str = Form(None),
):
    """
    Process a document through the full 5-stage forensic pipeline.
    OCR → Translation → NER → Entity Resolution → Relationships.
    """
    import tempfile
    from pathlib import Path

    pipeline = get_pipeline()

    # Save uploaded file temporarily
    suffix = Path(file.filename).suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = pipeline.process_document(
            file_path=tmp_path,
            case_id=case_id,
            document_type=document_type,
            force_language=force_language,
        )

        return PipelineResponse(
            document_id=result.document_id,
            case_id=result.case_id,
            success=result.success,
            original_file_hash=result.original_file_hash,
            ocr_text_hash=result.ocr_text_hash,
            translated_text_hash=result.translated_text_hash,
            pipeline_version=result.pipeline_version,
            ocr_confidence=result.ocr_confidence,
            source_language=result.source_language,
            was_translated=result.was_translated,
            entities=result.entities,
            relationships=result.relationships,
            entities_merged=result.resolution_report.merges if result.resolution_report else 0,
            entities_flagged_for_review=result.resolution_report.reviews if result.resolution_report else 0,
            processing_time_seconds=result.processing_time_seconds,
            stage_errors=result.stage_errors,
        )
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@router.get("/provenance/{case_id}/{document_id}", response_model=ProvenanceResponse)
async def get_provenance(case_id: str, document_id: str):
    """
    Get the full provenance chain for a processed document.
    Used for court verification and §63 certificate generation.
    """
    storage = TextStorage()
    raw = storage.get_raw_text(case_id, document_id)
    translated = storage.get_translated_text(case_id, document_id)

    import json
    from pathlib import Path
    prov_path = storage.base_dir / case_id / f"{document_id}_provenance.json"

    if not prov_path.exists():
        raise HTTPException(404, "Provenance record not found")

    prov = json.loads(prov_path.read_text())

    return ProvenanceResponse(
        document_id=document_id,
        case_id=case_id,
        hash_chain=prov["hash_chain"],
        ocr_language=prov["stages"]["ocr"]["language"],
        ocr_confidence=prov["stages"]["ocr"]["confidence"],
        translation_model=prov["stages"]["translation"]["model"],
        source_language=prov["stages"]["translation"]["source_language"],
        pipeline_version=prov["pipeline_version"],
        ingested_at=prov["timestamps"]["ingested_at"],
        raw_text_available=raw is not None,
        translated_text_available=translated is not None,
    )


@router.get("/verify/{case_id}/{document_id}", response_model=IntegrityCheckResponse)
async def verify_integrity(case_id: str, document_id: str):
    """
    Verify that a document has not been tampered with.
    Checks SHA-256 hashes at every stage of the pipeline.
    This is the API behind the "Catch-the-Tamper" demo.
    """
    storage = TextStorage()
    result = storage.verify_integrity(case_id, document_id)

    return IntegrityCheckResponse(
        document_id=document_id,
        is_valid=result["valid"],
        checks=result.get("checks", []),
        error=result.get("error"),
    )