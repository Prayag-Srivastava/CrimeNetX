"""Chatbot router — SSE streaming endpoint for the Investigator Assistant."""
from __future__ import annotations

import json
from typing import AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.models.schemas import ChatRequest
from app.services.chat_engine import stream_chat_response

router = APIRouter(prefix="/api/chat", tags=["Chat"])


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


@router.post("/query")
async def chat_query(payload: ChatRequest):
    """Stream the assistant's answer as Server-Sent Events."""
    async def stream() -> AsyncGenerator[str, None]:
        raw_dict = payload.context.model_dump()
        async for evt in stream_chat_response(
            question=payload.question,
            context=payload.context,
            raw_context=raw_dict,
            history=payload.history,
            user_role=payload.user_role,
            user_name=payload.user_name,
        ):
            yield _sse(evt)
        yield "event: end\ndata: {}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/health")
async def health():
    return {"status": "ok", "service": "chat"}