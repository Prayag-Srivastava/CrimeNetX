"""Agentic endpoints — LangGraph supervisor with SSE streaming."""
from __future__ import annotations

import json
from typing import Any, AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agents.supervisor_agent import run_analysis
from app.models.schemas import AgentEvent

router = APIRouter(prefix="/api/agents", tags=["Agentic"])


class AnalyzeRequest(BaseModel):
    case_id: str = ""
    case_number: str = ""
    fir_text: str = ""
    transactions: list[dict[str, Any]] = Field(default_factory=list)
    suspects: list[dict[str, Any]] = Field(default_factory=list)


def _sse(event: AgentEvent | dict) -> str:
    if isinstance(event, dict):
        event = AgentEvent(**event)
    return f"data: {json.dumps(event.model_dump(mode='json'), default=str)}\n\n"


@router.post("/analyze-case/{case_id}")
async def analyze_case(case_id: str, payload: AnalyzeRequest | None = None):
    """Run the full multi-agent analysis. Returns SSE stream of progress events.

    Client: new EventSource/SSE reader consuming `data:` lines until `complete`.
    """
    data = payload or AnalyzeRequest(case_id=case_id)

    async def stream() -> AsyncGenerator[str, None]:
        from app.agents.supervisor_agent import run_analysis_stream

        async for evt in run_analysis_stream(data.model_dump()):
            yield _sse(evt)
        yield "event: end\ndata: {}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable proxy buffering for live SSE
        },
    )


@router.post("/analyze-case/{case_id}/sync")
async def analyze_case_sync(case_id: str, payload: AnalyzeRequest | None = None):
    """Non-streaming variant — returns the full event list at once."""
    data = payload or AnalyzeRequest(case_id=case_id)
    events = run_analysis(data.model_dump())
    return {"events": [e.model_dump(mode="json") for e in events]}
