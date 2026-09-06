"""Groq LLM client — the PRIMARY LLM for ALL CrimeNetX text & reasoning tasks.

Why Groq over Gemini for text: the Gemini free tier exhausts quickly under
agentic workloads. Groq's groq/compound-mini gives us high-throughput,
low-cost reasoning with JSON mode — ideal for entity post-processing,
relationship inference, MO extraction and the LangGraph supervisor.
"""
from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator, Type, TypeVar

from groq import Groq
from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger("crimenetx.groq")

T = TypeVar("T", bound=BaseModel)


def _client() -> Groq | None:
    if not settings.groq_enabled:
        return None
    return Groq(api_key=settings.groq_api_key)


def groq_chat(messages: list[dict[str, str]], model: str | None = None, temperature: float = 0.2) -> str:
    """Plain chat completion. Returns the assistant text.

    If Groq is not configured, returns an empty string — callers must fall
    back to deterministic rule-based logic (see nlp_extractor / mo_fingerprint).
    """
    client = _client()
    if client is None:
        logger.warning("groq_api_key not set — skipping LLM call (rule-based fallback active)")
        return ""
    resp = client.chat.completions.create(
        model=model or settings.groq_model,
        messages=messages,
        temperature=temperature,
        max_tokens=4096,
    )
    return resp.choices[0].message.content or ""


async def groq_chat_stream(
    messages: list[dict[str, str]],
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 2048,
) -> AsyncGenerator[str, None]:
    """Streaming chat completion — yields token chunks as they arrive.

    Used by the investigator chatbot for real-time typing effect.
    If Groq is not configured, yields a single fallback message.
    """
    client = _client()
    if client is None:
        yield "⚠️ Chatbot unavailable — GROQ_API_KEY not configured on the AI service."
        return

    try:
        stream = client.chat.completions.create(
            model=model or settings.groq_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                yield delta
    except Exception as exc:
        logger.error("groq_chat_stream failed: %s", exc)
        yield f"\n\n⚠️ Streaming error: {str(exc)}"


def groq_structured(prompt: str, schema: Type[T], model: str | None = None, temperature: float = 0.1) -> T | None:
    """Groq call returning JSON that validates against a Pydantic schema.

    Uses Groq's JSON mode: the schema is described in the system prompt and
    the response is forced to valid JSON, then validated by Pydantic v2.
    """
    client = _client()
    if client is None:
        return None
    system = (
        "You are CrimeNetX, a police investigation intelligence assistant. "
        "Respond ONLY with valid JSON matching this exact structure:\n"
        f"{schema.model_json_schema()}\n"
        "Do not include markdown fences or commentary."
    )
    try:
        resp = client.chat.completions.create(
            model=model or settings.groq_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=temperature,
            max_tokens=4096,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        return schema.model_validate(json.loads(raw))
    except Exception as exc:
        logger.warning("groq_structured failed (%s) — returning None", exc)
        return None


def groq_complete_with_json(prompt: str, model: str | None = None) -> dict[str, Any] | None:
    """Generic JSON-object completion used by agents (LangGraph nodes)."""
    client = _client()
    if client is None:
        return None
    try:
        resp = client.chat.completions.create(
            model=model or settings.groq_model,
            messages=[
                {"role": "system", "content": "Reply with valid JSON only. No markdown."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=4096,
            response_format={"type": "json_object"},
        )
        raw = (resp.choices[0].message.content or "{}").strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        return json.loads(raw)
    except Exception as exc:
        logger.warning("groq_complete_with_json failed (%s)", exc)
        return None