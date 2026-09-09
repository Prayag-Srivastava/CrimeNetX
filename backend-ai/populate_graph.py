"""
Populate the CrimeNetX case graphs from the repo's own mock FIRs.

Runs each mock FIR through GLiNER-relex (entities + relations), then imports the
result into the running app via /evidence/:caseId/import-nlp. Each FIR is routed
to the case whose number matches its filename, so every case gets its own graph:

    FIR_MUM_2024_0331.pdf  ->  case MUM-2024-0331
    FIR_PUN_2024_0118.pdf  ->  case PUN-2024-0118
    ...

Without this, `npx prisma db seed` gives the Pune case a hand-written graph and
leaves the other four cases with no nodes and no edges at all.

PREREQUISITES
-------------
1. Mock FIRs generated:      python -m data.generate_mock_data
   (data/generated/ is gitignored, so this step is required on a fresh clone -
   the PDFs are not in the repo)
2. Database seeded:          cd ../backend-node && npx prisma db seed
3. backend-node running on :5000
4. GLiNER deps installed:    pip install -r requirements.txt

First run downloads the ~3.5 GB relex model and takes roughly ten minutes for
all five FIRs; later runs reuse the cached model. Re-running is safe - the
importer dedupes, so cases are not double-populated.

NOTE ON BRANCHES
----------------
GLiNER extraction lives on this branch; the app/database may be running from a
different branch. The script talks to the backend over HTTP and sends the
relation list under both the `relations` and `relationships` keys, so it works
against either backend - whichever key that version reads, the other is ignored.

CONFIG (all optional - sensible defaults)
-----------------------------------------
    CRIMENETX_API        default http://localhost:5000/api
    CRIMENETX_EMAIL      default dgp@crimenetx.gov.in
    CRIMENETX_PASSWORD   default Test@1234   (the seed script's demo password)
    MOCK_FIR_DIR         default <repo>/backend-ai/data/generated/mock_firs

USAGE
-----
    python populate_graph.py                    # every mock FIR
    python populate_graph.py FIR_PUN_2024_0118  # just one
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path
from urllib import request as urlreq

warnings.filterwarnings("ignore")

HERE = Path(__file__).resolve().parent                       # backend-ai/
API = os.getenv("CRIMENETX_API", "http://localhost:5000/api")
EMAIL = os.getenv("CRIMENETX_EMAIL", "dgp@crimenetx.gov.in")
PASSWORD = os.getenv("CRIMENETX_PASSWORD", "Test@1234")
MOCK_DIR = Path(os.getenv("MOCK_FIR_DIR", HERE / "data" / "generated" / "mock_firs"))

# The six RelationType values the Prisma schema accepts.
VALID_RELATIONS = {"phone_call", "financial_transfer", "family",
                   "associate", "same_organization", "co_location"}


# ----------------------------------------------------------------- http
def _req(path, payload=None, token=None, timeout=600):
    url = API + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urlreq.Request(url, data=data, method="POST" if data else "GET")
    if data:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urlreq.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "{}")


def login() -> str:
    """Fresh token per import - GLiNER is slow enough that JWTs can expire mid-run."""
    auth = _req("/auth/login", {"email": EMAIL, "password": PASSWORD}, timeout=60)
    tok = auth.get("accessToken") or auth.get("token") or (auth.get("data") or {}).get("accessToken")
    if not tok:
        raise RuntimeError(f"login failed: {json.dumps(auth)[:200]}")
    return tok


# ----------------------------------------------------------------- pdf
def pdf_text(p: Path) -> str:
    """Extract in a subprocess - PyMuPDF and torch segfault together on Windows."""
    tmp = Path(tempfile.gettempdir()) / "_crimenetx_fir_text.txt"
    code = ("import sys,io,fitz;"
            "t=chr(10).join(pg.get_text() for pg in fitz.open(sys.argv[1]));"
            "io.open(sys.argv[2],'w',encoding='utf-8').write(t)")
    out = subprocess.run([sys.executable, "-c", code, str(p), str(tmp)], capture_output=True)
    if out.returncode != 0:
        raise RuntimeError(f"pdf text extraction failed: {out.stderr[:200]}")
    text = io.open(tmp, encoding="utf-8").read()
    tmp.unlink(missing_ok=True)
    return text


def case_number_from(filename_stem: str) -> str | None:
    """FIR_MUM_2024_0331 -> MUM-2024-0331"""
    m = re.match(r"FIR_([A-Z]+)_(\d{4})_(\d+)$", filename_stem)
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


# ----------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("fir", nargs="?", help="single FIR stem, e.g. FIR_PUN_2024_0118")
    args = ap.parse_args()

    if not MOCK_DIR.exists():
        print(f"Mock FIRs not found at {MOCK_DIR}")
        print("Generate them first:  python -m data.generate_mock_data")
        return 1

    pdfs = sorted(p for p in MOCK_DIR.glob("*.pdf")
                  if not args.fir or p.stem == args.fir)
    if not pdfs:
        print(f"No matching PDFs in {MOCK_DIR}")
        return 1

    print(f"api    : {API}")
    print(f"firs   : {MOCK_DIR}  ({len(pdfs)} documents)")

    try:
        token = login()
    except Exception as e:
        print(f"\nCannot reach the backend: {e}")
        print("Is backend-node running on :5000, and has the database been seeded?")
        return 1

    cases = _req("/cases", token=token, timeout=60)
    rows = cases.get("data") or cases.get("cases") or cases.get("items") or []
    by_number = {str(c.get("caseNumber")): c["id"] for c in rows}
    if not by_number:
        print("No cases found - run `npx prisma db seed` in backend-node first.")
        return 1
    print(f"cases  : {', '.join(sorted(by_number))}\n")

    from app.services.nlp_extractor import NLPExtractor
    import app.config as cfg
    ex = NLPExtractor()
    print(f"engine    : {ex._extraction_engine}")
    print(f"adjacency : {cfg.RELEX_ADJACENCY_THRESHOLD}"
          f"   (above ~0.5 relation extraction returns nothing)\n")

    total_e = total_r = 0
    for pdf in pdfs:
        case_no = case_number_from(pdf.stem)
        case_id = by_number.get(case_no) if case_no else None
        if not case_id:
            print(f"  {pdf.stem:24s} SKIP (no case {case_no})")
            continue

        try:
            text = pdf_text(pdf)
        except Exception as e:
            print(f"  {pdf.stem:24s} SKIP ({e})")
            continue
        if len(text.strip()) < 200:
            print(f"  {pdf.stem:24s} SKIP (no text layer - needs OCR)")
            continue

        # Public entry point, so this script exercises the same path the agents
        # do: relex -> regex merge -> person validation -> relation alignment.
        ents, rels = ex.extract_entities_and_relations(text)

        entities, seen = [], set()
        for e in ents:
            val = str(e.get("text", "")).strip()
            lab = str(e.get("label", "")).upper()
            if not val or not lab or (lab, val.upper()) in seen:
                continue
            seen.add((lab, val.upper()))
            entities.append({
                "label": lab, "text": val,
                "type": lab, "value": val,          # both shapes, see note below
                "confidence": float(e.get("confidence", 0.8)),
                "layer": "gliner-relex",
                "start": int(e.get("start", 0)), "end": int(e.get("end", 0)),
                "source_sentence": str(e.get("source_sentence", ""))[:200],
                "page": int(e.get("page", 1)),
            })

        relations, rseen = [], set()
        for r in rels:
            s, t = str(r.get("source", "")).strip(), str(r.get("target", "")).strip()
            rel = str(r.get("relation", "associate")).lower()
            if rel not in VALID_RELATIONS:
                rel = "associate"
            key = (s.upper(), rel, t.upper())
            if not s or not t or s.upper() == t.upper() or key in rseen:
                continue
            rseen.add(key)
            relations.append({
                "source": s, "target": t, "relation": rel,
                "evidence": str(r.get("evidence", ""))[:400] or f"GLiNER-relex [{rel}]",
                "weight": float(r.get("weight", 1.0)),
            })

        file_hash = hashlib.sha256(pdf.read_bytes()).hexdigest()
        text_hash = hashlib.sha256(text.encode()).hexdigest()
        # Older backends read `relations`, newer ones `relationships` - send both,
        # the unused key is simply ignored.
        body = {
            "source": pdf.name,
            "entities": entities,
            "relations": relations,
            "relationships": relations,
            "document_id": f"{pdf.stem}_{file_hash[:8]}",
            "original_file_hash": file_hash,
            "ocr_text_hash": text_hash,
            "translated_text_hash": text_hash,
            "pipeline_version": f"gliner-relex-adj-{cfg.RELEX_ADJACENCY_THRESHOLD}",
            "ocr_confidence": 100.0,
            "source_language": "en",
            "was_translated": False,
        }

        try:
            out = _req(f"/evidence/{case_id}/import-nlp", body, token=login())
            created = out.get("createdEdges", out.get("relationCount", len(relations)))
            print(f"  {pdf.stem:24s} -> {case_no:16s} "
                  f"{len(entities):3d} entities, {len(relations):2d} relations "
                  f"(edges: {created})")
            total_e += len(entities)
            total_r += len(relations)
        except Exception as e:
            detail = ""
            if hasattr(e, "read"):
                try:
                    detail = e.read().decode()[:200]
                except Exception:
                    pass
            if "timed out" in str(e).lower():
                # the server keeps processing after the client gives up
                print(f"  {pdf.stem:24s} -> {case_no:16s} sent (client timeout; "
                      f"server still importing)")
                total_e += len(entities)
                total_r += len(relations)
            else:
                print(f"  {pdf.stem:24s} FAILED: {e} {detail}")

    print(f"\ntotal: {total_e} entities, {total_r} relations")
    print("Open any case in the app and click the Network tab.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
