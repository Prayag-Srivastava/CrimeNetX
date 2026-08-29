"""PDF parsing utilities.

Supports both filesystem paths and in-memory uploaded PDF streams.

- PyMuPDF (fitz): primary text extraction for FIR PDFs.
- pypdf: metadata forensics (author, producer, creation date, etc.).
"""
from __future__ import annotations

import io
import logging
from pathlib import Path
from typing import BinaryIO

logger = logging.getLogger("crimenetx.pdf")


PdfSource = str | Path | bytes | bytearray | BinaryIO


def _read_pdf_bytes(source: PdfSource) -> bytes:
    """Normalize a PDF source into raw bytes."""
    if isinstance(source, bytes):
        return source

    if isinstance(source, bytearray):
        return bytes(source)

    if isinstance(source, (str, Path)):
        return Path(source).read_bytes()

    if hasattr(source, "read"):
        # Preserve the caller's current position where possible.
        try:
            current_pos = source.tell()
        except Exception:
            current_pos = None

        try:
            source.seek(0)
        except Exception:
            pass

        data = source.read()

        if current_pos is not None:
            try:
                source.seek(current_pos)
            except Exception:
                pass

        return data

    raise TypeError(f"Unsupported PDF source type: {type(source)!r}")


def extract_text_from_pdf(source: PdfSource) -> str:
    """Extract all text from a PDF via PyMuPDF."""
    import fitz  # PyMuPDF

    if isinstance(source, (str, Path)):
        doc = fitz.open(str(source))
    else:
        pdf_bytes = _read_pdf_bytes(source)
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    try:
        pages = [page.get_text("text") for page in doc]
        return "\n\n--- PAGE BREAK ---\n\n".join(
            p for p in pages if p.strip()
        )
    finally:
        doc.close()


def extract_pdf_metadata(source: PdfSource) -> dict:
    """Extract forensic PDF metadata using pypdf."""
    from pypdf import PdfReader

    if isinstance(source, (str, Path)):
        reader = PdfReader(str(source))
    else:
        pdf_bytes = _read_pdf_bytes(source)
        reader = PdfReader(io.BytesIO(pdf_bytes))

    meta = dict(reader.metadata or {})

    return {
        "page_count": len(reader.pages),
        "title": str(meta.get("/Title", "")),
        "author": str(meta.get("/Author", "")),
        "creator": str(meta.get("/Creator", "")),
        "producer": str(meta.get("/Producer", "")),
        "created": str(meta.get("/CreationDate", "")),
        "modified": str(meta.get("/ModDate", "")),
    }


def parse_fir_pdf(source: PdfSource) -> tuple[str, dict]:
    """Extract text + forensic metadata from an FIR PDF."""
    return extract_text_from_pdf(source), extract_pdf_metadata(source)