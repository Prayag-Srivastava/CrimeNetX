"""Investigator Chatbot RAG Engine.

Universal context retrieval across:
  1. ChromaDB semantic vector search (extracts full FIR narratives)
  2. Local CrimeNetX case datasets (historical_cases.json & case_entity_bundle.json)
  3. PostgreSQL relational database bundle (live DB entities, suspects, CDR, bank records)
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, AsyncGenerator

from app.db.chroma_client import search_firs
from app.llm.groq_client import groq_chat_stream, groq_complete_with_json
from app.models.schemas import ChatContextBundle, ChatIntent, ChatMessageIn

logger = logging.getLogger("crimenetx.chat")

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "generated")


def _load_historical_cases() -> list[dict[str, Any]]:
    """Loads pre-generated historical cases dataset if available."""
    try:
        path = os.path.join(DATA_DIR, "historical_cases.json")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        logger.warning("Failed to load historical_cases.json: %s", e)
    return []


def _find_matching_historical_case(query: str) -> dict[str, Any] | None:
    """Matches user questions to specific cases like Hinjewadi, Pune, Mumbai, etc."""
    q = query.lower()
    cases = _load_historical_cases()
    for c in cases:
        c_num = str(c.get("case_number", "")).lower()
        title = str(c.get("title", "")).lower()
        jur = str(c.get("jurisdiction", "")).lower()
        fir = str(c.get("fir_text", "")).lower()

        if (
            (c_num and c_num in q)
            or ("hinjewadi" in q and "hinjewadi" in (title + jur + fir))
            or ("snatching" in q and "snatching" in (title + fir))
            or ("ransomware" in q and "ransomware" in (title + fir))
            or ("passport" in q and "passport" in (title + fir))
            or ("arms" in q and "arms" in (title + fir))
            or ("pune" in q and "pune" in jur)
            or ("mumbai" in q and "mumbai" in jur)
            or ("nagpur" in q and "nagpur" in jur)
        ):
            return c
    return None


def classify_intent(question: str, has_case_context: bool) -> ChatIntent:
    prompt = (
        "Classify this police investigator's question into exactly ONE intent.\n\n"
        "Intents:\n"
        "- factual_case: asking about case details, suspects, events, timeline, locations, evidence, investigation summary\n"
        "- network_analysis: asking about kingpins, brokers, roles, relationships, network structure\n"
        "- financial_trail: asking about money flow, transactions, laundering, bank accounts, crypto\n"
        "- crime_theory: asking HOW crime was planned/executed, motive, hypothesis, reconstruction\n"
        "- cross_case: asking about similar cases, serial patterns, other syndicates\n"
        "- interrogation: asking questions to interrogate a suspect, contradictions, leverage\n"
        "- general: greeting, capabilities overview, generic question\n\n"
        f"Question: {question}\n"
        f"Has case context: {has_case_context}\n\n"
        'Return JSON: {"intent": "one_of_the_above"}'
    )
    result = groq_complete_with_json(prompt)
    if not result:
        return ChatIntent.FACTUAL_CASE
    try:
        return ChatIntent(result.get("intent", "factual_case"))
    except ValueError:
        return ChatIntent.FACTUAL_CASE


def _retrieve_chroma_firs(question: str) -> str:
    """Semantic vector search across stored FIRs."""
    try:
        hits = search_firs(question[:3000], n_results=2)
        if not hits:
            return ""
        lines = ["=== RELEVANT FIR NARRATIVES FROM VECTOR DATABASE ==="]
        for h in hits:
            meta = h.get("metadata") or {}
            c_num = meta.get("case_number", h.get("case_id", ""))
            doc = h.get("document", "")
            if doc:
                lines.append(f"\n[FIR REF: {c_num}]\n{doc[:2500]}")
        return "\n".join(lines) if len(lines) > 1 else ""
    except Exception as exc:
        logger.warning("Chroma retrieval failed: %s", exc)
        return ""


def build_context_block(question: str, intent: ChatIntent, ctx: ChatContextBundle, raw_dict: dict) -> str:
    parts: list[str] = []

    # 1. Check if Postgres provided case info
    if ctx.case_number or ctx.case_title:
        parts.append(
            f"=== TARGET CASE: {ctx.case_number} — {ctx.case_title} ===\n"
            f"Status: {ctx.case_status} | Priority: {ctx.case_priority} | Jurisdiction: {ctx.jurisdiction}\n"
            f"Case Description: {ctx.description}"
        )

    # 2. Check Historical Case Dataset (Rich fallback)
    hist_case = _find_matching_historical_case(question)
    if hist_case:
        parts.append(
            f"=== CASE RECORD: {hist_case.get('case_number')} — {hist_case.get('title')} ===\n"
            f"Jurisdiction: {hist_case.get('jurisdiction')} | Date: {hist_case.get('date', 'Recent')}\n\n"
            f"FIR NARRATIVE & INCIDENT DETAILS:\n{hist_case.get('fir_text', '')}\n\n"
            f"IDENTIFIED SUSPECTS & ACCUSED:\n"
            + "\n".join(
                f"  • {s.get('name')} (Aliases: {', '.join(s.get('aliases', []))}) — Role: {s.get('role')} | Kingpin Score: {s.get('kingpin_score', 0)}"
                for s in hist_case.get("suspects", [])
            )
        )

        if hist_case.get("entities"):
            parts.append(
                "EXTRACTED ENTITIES:\n"
                + "\n".join(f"  • [{e.get('type')}] {e.get('value')}" for e in hist_case.get("entities", [])[:15])
            )

        if hist_case.get("cdrs"):
            parts.append(
                "CALL DETAIL RECORDS (CDR):\n"
                + "\n".join(
                    f"  • {c.get('from_number')} -> {c.get('to_number')} ({c.get('duration_sec', 0)}s at {c.get('call_time')})"
                    for c in hist_case.get("cdrs", [])[:10]
                )
            )

        if hist_case.get("transactions"):
            parts.append(
                "FINANCIAL TRANSACTIONS:\n"
                + "\n".join(
                    f"  • ₹{t.get('amount', 0):,} ({t.get('from_account')} -> {t.get('to_account')})"
                    for t in hist_case.get("transactions", [])[:10]
                )
            )

    # 3. FIR texts from live DB (if any)
    if ctx.fir_texts:
        joined = "\n---\n".join(t[:2500] for t in ctx.fir_texts[:2])
        parts.append(f"LIVE FIR RECORDS:\n{joined}")

    # 4. Suspects & Entities from live DB (if available)
    if ctx.suspects:
        parts.append(
            "DATABASE SUSPECTS:\n"
            + "\n".join(
                f"  • {s.get('name')} (Aliases: {', '.join(s.get('aliases', []) or [])}) | Role: {s.get('role')} | Kingpin Score: {s.get('kingpinScore', 0)}"
                for s in ctx.suspects
            )
        )

    if ctx.nodes:
        kingpins = [n.get("label") for n in ctx.nodes if n.get("role") == "KINGPIN"]
        brokers = [n.get("label") for n in ctx.nodes if n.get("role") == "BROKER"]
        executors = [n.get("label") for n in ctx.nodes if n.get("role") == "EXECUTOR"]
        parts.append(
            f"CRIMINAL NETWORK STRUCTURE ({len(ctx.nodes)} nodes, {len(ctx.edges)} relations):\n"
            f"  • Kingpins: {', '.join(kingpins) if kingpins else 'None designated'}\n"
            f"  • Brokers/Intermediaries: {', '.join(brokers) if brokers else 'None'}\n"
            f"  • Executors: {', '.join(executors[:10]) if executors else 'None'}"
        )

    # 5. ChromaDB Vector Store Search (Direct text extraction)
    chroma_text = _retrieve_chroma_firs(question)
    if chroma_text:
        parts.append(chroma_text)

    # 6. Global Catalog (if broad question)
    catalog = raw_dict.get("global_cases_catalog", [])
    if catalog and not hist_case and not ctx.case_number:
        cat_lines = ["SYSTEM CASES IN DATABASE:"]
        for c in catalog:
            cat_lines.append(
                f"  • [{c.get('case_number')}] \"{c.get('title')}\" ({c.get('jurisdiction')}) — Status: {c.get('status')}"
            )
        parts.append("\n".join(cat_lines))

    return "\n\n".join(p for p in parts if p)


_BASE_SYSTEM = """You are CrimeNetX Assistant — a senior crime intelligence analyst
helping an Indian police officer investigate cases. You have access to case FIR narratives,
extracted entities, criminal network graphs, phone records, financial transactions, and evidence chains.

STRICT OPERATING INSTRUCTIONS:
1. Ground your answers thoroughly in the provided case records and FIR narratives.
2. Structure your response professionally for police investigators using markdown headings,
   summary tables, and clean bullet points.
3. When summarizing a case, ALWAYS include:
   - **Case Overview**: Case Number, Title, Jurisdiction, Incident Date & Time
   - **Key Persons & Accused**: Name, Aliases, Role (Kingpin / Broker / Snatcher / Fence)
   - **Modus Operandi & Events**: How the crime was executed, getaway vehicles used
   - **Evidence & Trail**: Stolen property, CDR call links, financial transfers, recovered items
   - **Legal Sections**: Applicable Bharatiya Nyaya Sanhita (BNS 2024) sections
   - **Recommended Next Steps**: Key actionable leads for field officers
4. For speculative analysis or crime theories, label them with **⚠️ HYPOTHESIS:** and confidence rating.
5. Reference Indian legal context: BNS 2024 sections (not old IPC), BNSS for procedure.
"""


async def stream_chat_response(
    question: str,
    context: ChatContextBundle,
    raw_context: dict,
    history: list[ChatMessageIn],
    user_role: str = "INVESTIGATOR",
    user_name: str = "Officer",
) -> AsyncGenerator[dict[str, Any], None]:
    # 1. Intent
    intent = classify_intent(question, has_case_context=bool(context.case_id or context.case_number))
    yield {"type": "intent", "data": {"intent": intent.value}}

    # 2. Context retrieval
    context_block = build_context_block(question, intent, context, raw_context)
    yield {
        "type": "context",
        "data": {
            "intent": intent.value,
            "context_length": len(context_block),
            "sources_loaded": bool(context_block),
        },
    }

    # 3. System prompt & History
    system = _BASE_SYSTEM + f"\n\nUser: {user_name} ({user_role})\nIntent: {intent.value}"

    messages: list[dict[str, str]] = [{"role": "system", "content": system}]

    for h in history[-6:]:
        messages.append({"role": h.role, "content": h.content})

    user_content = (
        f"OFFICER'S QUESTION:\n{question}\n\n"
        f"===== CASE EVIDENCE & DATABASE RECORDS =====\n{context_block}\n===== END RECORDS ====="
    )
    messages.append({"role": "user", "content": user_content})

    # 4. Stream tokens
    try:
        async for token in groq_chat_stream(messages, temperature=0.3, max_tokens=2500):
            yield {"type": "token", "data": {"text": token}}
    except Exception as exc:
        logger.error("stream_chat_response error: %s", exc)
        yield {"type": "error", "data": {"message": str(exc)}}
        return

    yield {"type": "done", "data": {"intent": intent.value}}