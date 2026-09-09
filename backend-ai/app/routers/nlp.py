"""
CrimeNetX — NLP Router
=======================
Provides both:
  - /nlp/process-document (new 5-stage pipeline)
  - /nlp/extract-from-pdf (legacy endpoint used by FIRUploader.tsx)
"""

import tempfile
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel, Field
from app.services.pipeline import ForensicPipeline
from app.models.schemas import PipelineResponse, ProvenanceResponse, IntegrityCheckResponse
from app.utils.text_storage import TextStorage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/nlp", tags=["NLP Pipeline"])

# Initialize pipeline lazily (models load on first request)
_pipeline = None


def get_pipeline():
    global _pipeline
    if _pipeline is None:
        _pipeline = ForensicPipeline()
    return _pipeline


# ============================================================
# NEW ENDPOINT: Full 5-Stage Pipeline
# ============================================================
@router.post("/process-document", response_model=PipelineResponse)
async def process_document(
    file: UploadFile = File(...),
    case_id: str = Form(...),
    document_type: str = Form("FIR"),
    force_language: Optional[str] = Form(None),
):
    """Process a document through the full 5-stage forensic pipeline."""
    pipeline = get_pipeline()

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


# ============================================================
# LEGACY ENDPOINT (Adapter for existing FIRUploader.tsx)
# Returns response in { entities, relations, llm_used, warnings } format
# ============================================================
@router.post("/extract-from-pdf")
async def extract_from_pdf(
    file: UploadFile = File(...),
    case_id: Optional[str] = Form("legacy-upload"),
    force_language: Optional[str] = Form(None),
):
    """
    Legacy endpoint for FIRUploader.tsx.
    Runs full pipeline but returns response in the format frontend expects.
    """
    pipeline = get_pipeline()

    suffix = Path(file.filename).suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = pipeline.process_document(
            file_path=tmp_path,
            case_id=case_id or "legacy-upload",
            document_type="FIR",
            force_language=force_language,
        )

        # ---- Transform entities to frontend format ----
        # Frontend expects: { type, value, confidence, layer, attributes }
        # Pipeline returns: { text, label, start, end, source_sentence, page }
        entities_frontend = []
        for ent in result.entities:
            entities_frontend.append({
                "type": ent.get("label", "UNKNOWN"),
                "value": ent.get("text", ""),
                "confidence": 0.9 if ent.get("label") in ("PERSON", "ORG", "GPE") else 0.75,
                "layer": "spacy" if ent.get("label") in (
                    "PERSON", "ORG", "GPE", "DATE", "MONEY", "CARDINAL", "TIME", "EVENT", "LAW"
                ) else "regex",
                "attributes": {
                    "start": ent.get("start"),
                    "end": ent.get("end"),
                    "source_sentence": ent.get("source_sentence", "")[:200],
                    "page": ent.get("page", 1),
                },
            })

        # ---- Transform relationships to frontend format ----
        # Frontend expects field name: relations (not relationships)
        relations_frontend = []
        for rel in result.relationships:
            relations_frontend.append({
                "source": rel.get("source", ""),
                "target": rel.get("target", ""),
                "relation": rel.get("relation", "associate"),
                "evidence": rel.get("evidence", ""),
                "weight": rel.get("weight", 1.0),
            })

        return {
            "entities": entities_frontend,
            "relations": relations_frontend,
            "llm_used": bool(result.relationships and "Co-mentioned" not in result.relationships[0].get("evidence", "")) if result.relationships else False,
            "warnings": result.stage_errors,
            "meta": {
                "document_id": result.document_id,
                "ocr_confidence": result.ocr_confidence,
                "source_language": result.source_language,
                "was_translated": result.was_translated,
                "translation_model": result.translation_model,
                "original_file_hash": result.original_file_hash,
                "processing_time_seconds": result.processing_time_seconds,
                "pipeline_version": result.pipeline_version,
            },
        }
    except Exception as e:
        logger.error(f"extract-from-pdf failed: {e}", exc_info=True)
        raise HTTPException(500, f"Pipeline failed: {str(e)}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# ============================================================
# PROVENANCE ENDPOINT
# ============================================================
@router.get("/provenance/{case_id}/{document_id}", response_model=ProvenanceResponse)
async def get_provenance(case_id: str, document_id: str):
    """Get the full provenance chain for a processed document."""
    import json
    storage = TextStorage()

    raw = storage.get_raw_text(case_id, document_id)
    translated = storage.get_translated_text(case_id, document_id)

    prov_path = storage.base_dir / case_id / f"{document_id}_provenance.json"
    if not prov_path.exists():
        raise HTTPException(404, "Provenance record not found")

    prov = json.loads(prov_path.read_text(encoding="utf-8"))

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


# ============================================================
# TAMPER VERIFICATION ENDPOINT
# ============================================================
@router.get("/verify/{case_id}/{document_id}", response_model=IntegrityCheckResponse)
async def verify_integrity(case_id: str, document_id: str):
    """Verify that a document has not been tampered with."""
    storage = TextStorage()
    result = storage.verify_integrity(case_id, document_id)

    return IntegrityCheckResponse(
        document_id=document_id,
        is_valid=result["valid"],
        checks=result.get("checks", []),
        error=result.get("error"),
    )


# ============================================================
# CASE NETWORK REBUILD ENDPOINT (GLiNER-relex + SAMYOJAN + Graph ML)
# ============================================================
class RebuildCaseNetworkRequest(BaseModel):
    case_id: str
    case_narrative: Optional[str] = ""
    documents_text: Optional[list[str]] = []
    existing_entities: Optional[list[dict]] = []


@router.post("/rebuild-case-network")
async def rebuild_case_network(req: RebuildCaseNetworkRequest):
    """
    Full-cycle network rebuild:
    1. Extracts entities and relations from case narrative & evidence documents using GLiNER-relex joint extraction.
    2. Runs SAMYOJAN Entity Resolution to merge aliases and cross-references.
    3. Categorizes roles (VICTIM, WITNESS, POLICE_OFFICER, ALIAS, SUSPECT).
    4. Computes NetworkX graph analytics (PageRank, Betweenness, composite Kingpin score) while preventing victims/witnesses/police from being scored as syndicate leaders.
    5. Computes Ghost Link predictions between unlinked suspects with human-readable labels.
    """
    from app.services.graph_analyzer import analyze, build_graph
    from app.services.link_predictor import predict_links

    pipeline = get_pipeline()

    # 1. Combine narrative & documents
    text_blocks = []
    if req.case_narrative and req.case_narrative.strip():
        text_blocks.append(req.case_narrative.strip())

    # Load stored OCR/translated text from TextStorage for this case
    # This provides the actual evidence content rather than just filenames
    try:
        storage = TextStorage()
        import os
        case_dir = storage.base_dir / req.case_id
        if case_dir.exists():
            for f in sorted(case_dir.iterdir()):
                if f.suffix == ".txt" and ("_translated" in f.name or "_raw" in f.name):
                    stored_text = f.read_text(encoding="utf-8").strip()
                    if stored_text and len(stored_text) > 20:
                        text_blocks.append(stored_text)
                        logger.info(f"rebuild: loaded stored text from {f.name} ({len(stored_text)} chars)")
    except Exception as e:
        logger.warning(f"Could not load stored case texts: {e}")

    if req.documents_text:
        for doc in req.documents_text:
            if doc and doc.strip() and len(doc.strip()) > 30:
                # Only add if it looks like actual document text, not a filename
                text_blocks.append(doc.strip())

    combined_text = "\n\n".join(text_blocks)

    extracted_entities = []
    extracted_relations = []
    resolution_report = None

    if len(combined_text.strip()) >= 15:
        # Run GLiNER-relex joint extraction
        logger.info(f"rebuild: running GLiNER-relex on {len(combined_text)} chars of combined text")
        raw_ents, raw_rels = pipeline._get_nlp_extractor().extract_entities_and_relations(combined_text)
        logger.info(f"rebuild: GLiNER-relex produced {len(raw_ents)} entities, {len(raw_rels)} relations")
        # Run SAMYOJAN entity resolution
        try:
            resolved_ents, res_rep = pipeline.resolver.resolve_entities(raw_ents, case_id=req.case_id)
            extracted_entities = resolved_ents
            resolution_report = res_rep
        except Exception as e:
            logger.warning(f"SAMYOJAN resolution during rebuild failed, using raw: {e}")
            extracted_entities = raw_ents
        extracted_relations = raw_rels
    else:
        logger.warning(f"rebuild: combined text too short ({len(combined_text.strip())} chars), skipping extraction")

    # If text extraction produced no entities, fall back to existing_entities
    if not extracted_entities and req.existing_entities:
        extracted_entities = req.existing_entities

    # Standardize entity schema for graph processing
    graph_entities = []
    for ent in extracted_entities:
        val = ent.get("value") or ent.get("text") or ""
        if not val or len(val.strip()) < 2:
            continue
        etype = ent.get("type") or ent.get("label") or "ENTITY"
        eid = str(ent.get("id") or f"{etype}:{val}")
        role = ent.get("role")
        is_victim = bool(ent.get("is_victim") or role == "VICTIM" or "victim" in val.lower())
        is_witness = bool(ent.get("is_witness") or role == "WITNESS" or "witness" in val.lower())
        is_police = bool(ent.get("is_police") or role == "POLICE_OFFICER" or "inspector" in val.lower())
        is_alias = bool(ent.get("is_alias") or role == "ALIAS" or etype == "ALIAS")
        is_noise = bool(ent.get("is_noise") or is_alias or etype in ("DATE", "LAW_SECTION", "MONEY"))

        graph_entities.append({
            "id": eid,
            "value": val,
            "type": etype,
            "confidence": ent.get("confidence", 0.9),
            "role": role,
            "is_victim": is_victim,
            "is_witness": is_witness,
            "is_police": is_police,
            "is_alias": is_alias,
            "is_noise": is_noise,
        })

    # Run Graph ML Analytics
    graph = analyze(req.case_id, graph_entities, extracted_relations)

    # Run Ghost Link Predictions on the resulting NetworkX graph
    g_nx, _ = build_graph(req.case_id, graph_entities, extracted_relations)
    ghost_links = predict_links(g_nx, threshold=0.10) if g_nx.number_of_nodes() > 1 else []

    return {
        "success": True,
        "case_id": req.case_id,
        "entities": graph_entities,
        "relations": extracted_relations,
        "graph": graph.model_dump() if hasattr(graph, "model_dump") else graph,
        "predictions": [p.model_dump() if hasattr(p, "model_dump") else p for p in ghost_links],
        "resolution_report": {
            "merges": resolution_report.merges,
            "reviews": resolution_report.reviews,
        } if resolution_report else None,
    }