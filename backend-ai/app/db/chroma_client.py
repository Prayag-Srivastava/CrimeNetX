"""ChromaDB client — persistent local vector store for cross-referencing and
Modus Operandi fingerprints.

Collections:
  - "fir_embeddings"   : embedded historical FIR narratives (case_id + text)
  - "mo_fingerprints"  : MO feature vectors per case for serial-offender matching

Embeddings come from Chroma's bundled ONNX MiniLM (no external key needed).
"""
from __future__ import annotations

import logging
from functools import lru_cache

import chromadb
from chromadb.config import Settings as ChromaSettings

from app.config import settings

logger = logging.getLogger("crimenetx.chroma")

FIR_COLLECTION = "fir_embeddings"
MO_COLLECTION = "mo_fingerprints"


@lru_cache
def get_chroma_client():
    return chromadb.PersistentClient(
        path=settings.chroma_persist_dir,
        settings=ChromaSettings(anonymized_telemetry=False),
    )


def _collection(name: str):
    client = get_chroma_client()
    try:
        return client.get_collection(name)
    except Exception:
        return client.create_collection(
            name,
            metadata={"hnsw:space": "cosine"},
        )


def upsert_fir(case_id: str, case_number: str, text: str, source_date: str = ""):
    coll = _collection(FIR_COLLECTION)
    coll.upsert(
        ids=[case_id],
        documents=[text],
        metadatas=[{"case_number": case_number, "source_date": source_date}],
    )


def upsert_mo_fingerprint(case_id: str, feature_vector_text: str, meta: dict):
    coll = _collection(MO_COLLECTION)
    coll.upsert(ids=[case_id], documents=[feature_vector_text], metadatas=meta)


def search_firs(
    query: str,
    exclude_case_id: str | None = None,
    n_results: int = 10,
) -> list[dict]:
    """Semantic search over historical FIRs. Returns top-k with full document text."""
    coll = _collection(FIR_COLLECTION)

    total = coll.count()
    if total == 0:
        return []

    try:
        fetch_count = min(n_results + 1, total)

        res = coll.query(
            query_texts=[query],
            n_results=fetch_count,
        )

        out = []

        ids = (res.get("ids") or [[]])[0]
        dists = (res.get("distances") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        docs = (res.get("documents") or [[]])[0]

        for cid, dist, meta, doc in zip(ids, dists, metas, docs):
            if exclude_case_id and cid == exclude_case_id:
                continue

            out.append(
                {
                    "case_id": cid,
                    "distance": float(dist),
                    "metadata": meta or {},
                    "document": str(doc or ""),
                }
            )

            if len(out) >= n_results:
                break

        return out

    except Exception as exc:
        logger.warning("chroma query failed (%s)", exc)
        return []


def search_mo(query: str, exclude_case_id: str | None = None, n_results: int = 10) -> list[dict]:
    """Cosine-similarity MO search — finds serial offenders."""
    coll = _collection(MO_COLLECTION)
    if coll.count() == 0:
        return []
    try:
        where = {"case_id": {"$ne": exclude_case_id}} if exclude_case_id else None
        res = coll.query(query_texts=[query], n_results=min(n_results, coll.count()), where=where)
        ids = (res.get("ids") or [[]])[0]
        dists = (res.get("distances") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        out = []
        for cid, dist, meta in zip(ids, dists, metas):
            similarity = max(0.0, 1.0 - float(dist))
            out.append({"case_id": cid, "match_percentage": round(similarity * 100, 1), "metadata": meta or {}})
        return out
    except Exception as exc:
        logger.warning("chroma MO query failed (%s)", exc)
        return []