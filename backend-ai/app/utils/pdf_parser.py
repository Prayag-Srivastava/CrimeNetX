"""PDF parsing utilities.

- PyMuPDF (fitz): primary text extraction for FIR PDFs (fast, accurate).
- pypdf: metadata forensics (author, producer, creation date — useful to prove
  document provenance during investigation).
"""
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger("crimenetx.pdf")


def extract_text_from_pdf(path: str | Path) -> str:
    """Extract all text from a PDF via PyMuPDF."""
    import fitz  # PyMuPDF

    doc = fitz.open(str(path))
    try:
        pages = [page.get_text("text") for page in doc]
        return "\n\n--- PAGE BREAK ---\n\n".join(p for p in pages if p.strip())
    finally:
        doc.close()


def extract_pdf_metadata(path: str | Path) -> dict:
    """Forensic metadata: title/author/creator/producer/dates + page count."""
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    meta = dict(reader.metadata or {})
    # Pypdf returns dates as PdfObject — coerce to str for JSON safety
    return {
        "page_count": len(reader.pages),
        "title": str(meta.get("/Title", "")),
        "author": str(meta.get("/Author", "")),
        "creator": str(meta.get("/Creator", "")),
        "producer": str(meta.get("/Producer", "")),
        "created": str(meta.get("/CreationDate", "")),
        "modified": str(meta.get("/ModDate", "")),
    }


def parse_fir_pdf(path: str | Path) -> tuple[str, dict]:
    """Convenience: extract text + metadata for an uploaded FIR PDF."""
    return extract_text_from_pdf(path), extract_pdf_metadata(path)
