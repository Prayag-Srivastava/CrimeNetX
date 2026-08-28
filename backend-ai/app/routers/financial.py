"""Financial endpoints — money-flow tracing + laundering risk."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field

from app.models.schemas import LaunderingRisk, TraceRequest, TraceResult
from app.services.financial_tracer import laundering_risk, trace_flow

router = APIRouter(prefix="/api/financial", tags=["Financial"])


class TransactionsBody(BaseModel):
    transactions: list[dict[str, Any]] = Field(default_factory=list)
    source_account: str = ""
    target_account: str = ""


@router.post("/trace", response_model=TraceResult)
async def trace(payload: TransactionsBody):
    """Trace money flow from source to target account over the txn graph."""
    if not payload.transactions:
        raise HTTPException(400, "transactions required")
    if not payload.source_account or not payload.target_account:
        raise HTTPException(400, "source_account and target_account required")
    return trace_flow(payload.source_account, payload.target_account, payload.transactions)


@router.get("/laundering-risk/{case_id}", response_model=LaunderingRisk)
async def risk(case_id: str, transactions: list[dict[str, Any]] = Body(default=[])):
    if not transactions:
        raise HTTPException(400, "Pass transactions in body (POST) or use POST variant")
    return laundering_risk(case_id, transactions)


@router.post("/laundering-risk/{case_id}", response_model=LaunderingRisk)
async def risk_post(case_id: str, payload: TransactionsBody):
    return laundering_risk(case_id, payload.transactions)
