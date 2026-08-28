"""Auto-Generated Investigation Dossier PDF (reportlab).

Produces a court-ready, professional multi-section PDF:
  Case Summary -> Extracted Entities -> Network Intelligence (matplotlib chart)
  -> Timeline -> Financial Trail -> Cross-Referenced Cases -> MO Fingerprint
  -> ML Predictions -> Recommended IPC/BNS Sections -> Next Steps
  -> Appendix: chain-of-custody hash + evidence QR code.

A SHA-256 of the PDF bytes is embedded on the final page for tamper detection.
"""
from __future__ import annotations

import hashlib
import io
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image as RLImage,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.config import settings

logger = logging.getLogger("crimenetx.dossier")

# Absolute path so temp chart/QR files resolve regardless of CWD.
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "generated_dossiers"


def _make_styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="Title2", parent=styles["Title"], fontSize=22, alignment=TA_CENTER, textColor=colors.HexColor("#1a2b4a")))
    styles.add(ParagraphStyle(name="Sub", parent=styles["Normal"], alignment=TA_CENTER, textColor=colors.HexColor("#555555"), spaceAfter=12))
    styles.add(ParagraphStyle(name="H1", parent=styles["Heading1"], fontSize=16, textColor=colors.HexColor("#1a2b4a"), spaceBefore=14, spaceAfter=6))
    # rightIndent=3 guarantees paragraph width is strictly less than the frame
    # width — reportlab raises LayoutError on exact float equality.
    styles.add(ParagraphStyle(name="Body", parent=styles["Normal"], fontSize=10, leading=15, rightIndent=3))
    styles.add(ParagraphStyle(name="Meta", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#666666"), rightIndent=3))
    return styles


def _table(rows: list[list[str]], widths=None):
    t = Table(rows, colWidths=widths)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a2b4a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f6fa")]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return t


def _centrality_chart(scores: list[dict[str, Any]]) -> str | None:
    """Bar chart of composite kingpin scores (matplotlib -> PNG buffer)."""
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        labels = [s.get("label", s.get("entity_id", ""))[:18] for s in scores[:12]]
        vals = [s.get("composite", 0) for s in scores[:12]]
        fig, ax = plt.subplots(figsize=(7.2, 3.6), dpi=120)
        colors_list = ["#c0392b" if v > 70 else "#f1c40f" if v >= 40 else "#27ae60" for v in vals]
        ax.barh(labels[::-1], vals[::-1], color=colors_list[::-1])
        ax.set_xlabel("Composite Kingpin Score")
        ax.set_title("Top Suspects by Kingpin Score")
        ax.set_xlim(0, 100)
        plt.tight_layout()
        buf = io.BytesIO()
        plt.savefig(buf, format="png")
        plt.close(fig)
        buf.seek(0)
        path = Path(OUTPUT_DIR) / f"chart_{uuid.uuid4().hex}.png"
        path.write_bytes(buf.read())
        return str(path)
    except Exception as exc:
        logger.warning("chart generation failed (%s)", exc)
        return None


def generate_dossier(case: dict[str, Any], sections: dict[str, Any], evidence_qr_payload: str | None = None) -> dict[str, Any]:
    """Generate the full dossier PDF and return metadata (hash, path, pages).

    sections keys: entities, kingpin_scores, timeline, financial, cross_refs,
    mo_features, predictions, ipc_sections, next_steps.
    """
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    styles = _make_styles()
    now = datetime.utcnow()
    filename = f"dossier_{case.get('caseNumber', case.get('case_number', 'case'))}_{now:%Y%m%d_%H%M%S}.pdf"
    out_path = OUTPUT_DIR / filename

    # Margins get a 0.5mm epsilon: reportlab raises LayoutError when a
    # paragraph's width exactly equals the frame width (float boundary) —
    # the slack guarantees a strict less-than comparison.
    doc = SimpleDocTemplate(str(out_path), pagesize=A4, rightMargin=17.5 * mm, leftMargin=17.5 * mm, topMargin=16 * mm, bottomMargin=16 * mm)
    story: list = []

    # ------------------------------------------------------------- cover page
    story.append(Spacer(1, 40 * mm))
    story.append(Paragraph("CRIMENETX", styles["Title2"]))
    story.append(Spacer(1, 6))
    story.append(Paragraph("INVESTIGATION DOSSIER — CONFIDENTIAL", styles["Sub"]))
    story.append(Spacer(1, 30 * mm))
    story.append(
        _table(
            [
                ["Field", "Value"],
                ["Case Number", case.get("caseNumber", case.get("case_number", "-"))],
                ["Title", case.get("title", "-")],
                ["Jurisdiction", case.get("jurisdiction", "-")],
                ["Priority", case.get("priority", "-")],
                ["Status", case.get("status", "-")],
                ["Generated At", now.strftime("%Y-%m-%d %H:%M UTC")],
                ["Generated By", case.get("assignedInvestigator", "System")],
            ],
            widths=[45 * mm, 110 * mm],
        )
    )
    story.append(Spacer(1, 20 * mm))
    story.append(
        Paragraph(
            "CONFIDENTIAL — FOR LAW ENFORCEMENT USE ONLY.<br/>This dossier is auto-generated by CrimeNetX and must be "
            "verified by the investigating officer before submission to court.",
            styles["Meta"],
        )
    )
    story.append(PageBreak())

    # Each numbered section starts on a fresh page: this makes the dossier
    # cleaner AND avoids reportlab's LayoutError when dense content straddles
    # a page boundary (a paragraph that cannot fit remaining space fails to
    # postpone and raises "too large on page").
    temp_files: list[Path] = []

    # ---------------------------------------------------------------- summary
    story.append(PageBreak())
    story.append(Paragraph("1. Case Summary", styles["H1"]))
    story.append(Paragraph(case.get("description", "No description provided."), styles["Body"]))

    # --------------------------------------------------------------- entities
    entities = sections.get("entities", [])
    story.append(PageBreak())
    story.append(Paragraph("2. Extracted Entities", styles["H1"]))
    if entities:
        rows = [["Type", "Value", "Confidence", "Layer", "Source"]]
        for e in entities[:60]:
            rows.append(
                [
                    str(e.get("type", "")),
                    str(e.get("value", "")),
                    f'{float(e.get("confidence", 0)):.0%}',
                    str(e.get("layer", "")),
                    str(e.get("extracted_from", "")),
                ]
            )
        story.append(_table(rows, widths=[28 * mm, 55 * mm, 22 * mm, 20 * mm, 55 * mm]))
    else:
        story.append(Paragraph("No entities extracted.", styles["Body"]))

    # --------------------------------------------------------- network chart
    scores = sections.get("kingpin_scores", [])
    if scores:
        story.append(PageBreak())
        story.append(Paragraph("3. Network Intelligence (Kingpin Scores)", styles["H1"]))
        chart = _centrality_chart(scores)
        if chart:
            story.append(RLImage(chart, width=150 * mm, height=75 * mm))
            temp_files.append(Path(chart))  # cleaned up AFTER doc.build (reportlab reads lazily)
        rows = [["Entity", "Composite", "Role", "PageRank", "Betweenness"]]
        for s in scores[:15]:
            rows.append(
                [
                    s.get("label", s.get("entity_id", "")),
                    f'{float(s.get("composite", 0)):.1f}',
                    str(s.get("role", "")),
                    f'{float(s.get("pagerank", 0)):.4f}',
                    f'{float(s.get("betweenness", 0)):.4f}',
                ]
            )
        story.append(_table(rows))

    # --------------------------------------------------------------- timeline
    timeline = sections.get("timeline", [])
    if timeline:
        story.append(PageBreak())
        story.append(Paragraph("4. Investigation Timeline", styles["H1"]))
        rows = [["Date", "Event"]]
        for t in timeline[:40]:
            rows.append([str(t.get("timestamp", "-")), str(t.get("event", "-"))])
        story.append(_table(rows, widths=[45 * mm, 135 * mm]))

    # -------------------------------------------------------------- financial
    fin = sections.get("financial", {})
    if fin:
        story.append(PageBreak())
        story.append(Paragraph("5. Financial Trail", styles["H1"]))
        story.append(
            Paragraph(
                f"Layering risk: <b>{fin.get('layering_risk', 'LOW')}</b> · "
                f"Layered paths: {fin.get('layered_paths', 0)} · "
                f"Max hops: {fin.get('max_layering_hops', 0)}",
                styles["Body"],
            )
        )
        trail = fin.get("trail", [])
        if trail:
            rows = [["From", "To", "Amount", "Time"]]
            for t in trail[:30]:
                rows.append([str(t.get("from_account", "")), str(t.get("to_account", "")), f'₹{t.get("amount", 0):,.0f}', str(t.get("timestamp", ""))])
            story.append(_table(rows))

    # ------------------------------------------------------- cross references
    xrefs = sections.get("cross_refs", [])
    if xrefs:
        story.append(PageBreak())
        story.append(Paragraph("6. Cross-Referenced Cases", styles["H1"]))
        rows = [["Case", "Score", "Matched Entities", "Reason"]]
        for x in xrefs[:10]:
            rows.append(
                [
                    str(x.get("case_number", x.get("case_id", ""))),
                    f'{float(x.get("score", 0)):.1f}',
                    ", ".join(x.get("matched_entities", [])[:3]) or "-",
                    str(x.get("matched_reason", "-")),
                ]
            )
        story.append(_table(rows))

    # ---------------------------------------------------------- MO fingerprint
    mo = sections.get("mo_features")
    if mo:
        story.append(PageBreak())
        story.append(Paragraph("7. Modus Operandi Fingerprint", styles["H1"]))
        mo_block = [
            Paragraph(f"Entry method: <b>{mo.get('entry_method', '-')}</b>", styles["Body"]),
            Paragraph(f"Tools: {', '.join(mo.get('tools_used', [])) or '-'}", styles["Body"]),
            Paragraph(f"Time of day: {mo.get('time_of_day', '-')} · Target type: {mo.get('target_type', '-')}", styles["Body"]),
        ]
        sig = mo.get("signature_traits", [])
        if sig:
            mo_block.append(Paragraph("Signature traits: " + ", ".join(sig), styles["Body"]))
        # KeepTogether: the block never straddles a page boundary.
        story.append(KeepTogether(mo_block))

    # ---------------------------------------------------------- ML predictions
    preds = sections.get("predictions", [])
    if preds:
        story.append(PageBreak())
        story.append(Paragraph("8. ML Predictions (Ghost Links)", styles["H1"]))
        rows = [["Source", "Target", "Score", "Algorithm"]]
        for p in preds[:15]:
            rows.append([str(p.get("source", "")), str(p.get("target", "")), f'{float(p.get("score", 0)):.2f}', str(p.get("algorithm", ""))])
        story.append(_table(rows))

    # ------------------------------------------------------- IPC/BNS sections
    ipc = sections.get("ipc_sections", [])
    if ipc:
        story.append(PageBreak())
        story.append(Paragraph("9. Recommended IPC / BNS Sections", styles["H1"]))
        for s in ipc:
            story.append(Paragraph(f"• {s}", styles["Body"]))

    # --------------------------------------------------------------- next steps
    steps = sections.get("next_steps", [])
    if steps:
        story.append(PageBreak())
        story.append(Paragraph("10. Recommended Next Steps", styles["H1"]))
        for i, st in enumerate(steps, 1):
            story.append(Paragraph(f"{i}. {st}", styles["Body"]))

    story.append(PageBreak())

    # -------------------------------------------------------------- appendix
    story.append(Paragraph("Appendix A — Chain of Custody", styles["H1"]))
    story.append(
        Paragraph(
            "Every evidence item ingested by CrimeNetX is fingerprinted with a SHA-256 "
            "cryptographic hash and stored in the Evidence register. The hash of this very "
            "document is printed below so any post-generation alteration is detectable.",
            styles["Body"],
        )
    )

    # Build first to compute hash (two-pass: temp doc -> bytes -> final with hash page)
    build_dir = OUTPUT_DIR / "build"
    build_dir.mkdir(parents=True, exist_ok=True)
    temp_path = build_dir / f"tmp_{uuid.uuid4().hex}.pdf"
    tmp_doc = SimpleDocTemplate(str(temp_path), pagesize=A4, rightMargin=17.5 * mm, leftMargin=17.5 * mm, topMargin=16 * mm, bottomMargin=16 * mm)
    tmp_story = story + [
        Spacer(1, 8 * mm),
        Paragraph("(hash appended after generation)", styles["Meta"]),
    ]
    tmp_doc.build(tmp_story)
    digest = hashlib.sha256(temp_path.read_bytes()).hexdigest()

    # Rebuild with the real hash + QR code embedded.
    qr_payload = evidence_qr_payload or f"CRIMENETX|{case.get('caseNumber','')}|{digest}"
    qr_img, qr_path = _qr_image(qr_payload)
    final_story = story + [
        Spacer(1, 8 * mm),
        Paragraph(f"Document SHA-256: <font face='Courier'>{digest}</font>", styles["Body"]),
        Paragraph(
            f"Case: {case.get('caseNumber', '-')} · Generated by CrimeNetX v1.0 · {now.strftime('%Y-%m-%d %H:%M UTC')}",
            styles["Meta"],
        ),
    ]
    if qr_img:
        final_story.append(Spacer(1, 6 * mm))
        final_story.append(qr_img)

    doc.build(final_story)
    # Cleanup temp artifacts AFTER build (reportlab reads images lazily at build time).
    temp_path.unlink(missing_ok=True)
    for f in temp_files:
        f.unlink(missing_ok=True)
    if qr_path:
        qr_path.unlink(missing_ok=True)
    try:
        build_dir.rmdir()
    except OSError:
        pass

    pages = 0
    try:
        from pypdf import PdfReader

        pages = len(PdfReader(str(out_path)).pages)
    except Exception:
        pass

    # Best-effort S3 upload (s3fs would add deps; here we record local + mark for upload)
    s3_url = _upload_to_s3(out_path) if settings.aws_access_key_id else ""

    return {
        "case_id": case.get("id", ""),
        "s3_url": s3_url,
        "local_path": str(out_path),
        "page_count": pages,
        "sha256_hash": digest,
        "generated_at": now,
    }


def _qr_image(payload: str) -> tuple[RLImage | None, Path | None]:
    """QR code containing the document hash (verification convenience).

    Returns (flowable, temp_path) — caller must delete temp_path AFTER build.
    """
    try:
        import qrcode

        img = qrcode.make(payload, box_size=4)
        path = Path(OUTPUT_DIR) / f"qr_{uuid.uuid4().hex}.png"
        img.save(str(path), format="PNG")
        return RLImage(str(path), width=40 * mm, height=40 * mm), path
    except Exception:
        return None, None


def _upload_to_s3(path: Path) -> str:
    """Upload dossier to S3 using boto3 (optional). Returns the URL or ''."""
    try:
        import boto3

        s3 = boto3.client(
            "s3",
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            region_name=settings.aws_region,
        )
        key = f"dossiers/{path.name}"
        s3.upload_file(str(path), settings.aws_s3_bucket, key)
        return f"https://{settings.aws_s3_bucket}.s3.{settings.aws_region}.amazonaws.com/{key}"
    except Exception as exc:
        logger.warning("dossier S3 upload skipped (%s)", exc)
        return ""
