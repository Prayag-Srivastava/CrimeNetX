"""CrimeNetX AI Service — FastAPI entrypoint.

Serves the AI/ML/NLP microservice on port 8000:
  - NLP entity extraction (spaCy + regex + Groq)
  - Graph ML (NetworkX centrality, link prediction, clustering)
  - ChromaDB vector search (cross-reference, MO fingerprinting)
  - Gemini vision (CCTV / suspect photo matching)
  - Financial tracing & laundering risk
  - LangGraph agentic analysis over SSE
  - Dossier PDF generation
  - Investigator chatbot (RAG over case data)
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger as loguru_logger

from app.config import settings
from app.routers import agentic, chat, dossier, financial, graph_ml, nlp, vector, vision


@asynccontextmanager
async def lifespan(app: FastAPI):
    loguru_logger.info(f"CrimeNetX AI service starting — Groq enabled: {settings.groq_enabled}, Gemini enabled: {settings.gemini_enabled}")
    yield
    loguru_logger.info("CrimeNetX AI service shutting down")


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description=(
        "AI/ML microservice for CrimeNetX (SIH26189). Groq llama-3.3-70b for text, "
        "Gemini 1.5 Flash for vision, NetworkX for graph analytics, ChromaDB for vectors."
    ),
    lifespan=lifespan,
)

# CORS — the Node backend and frontend both talk to us.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins + ["http://localhost:3000", "http://localhost:5000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

# Routers
app.include_router(nlp.router)
app.include_router(graph_ml.router)
app.include_router(vision.router)
app.include_router(vector.router)
app.include_router(financial.router)
app.include_router(agentic.router)
app.include_router(dossier.router)
app.include_router(chat.router)


@app.get("/", tags=["meta"])
async def root():
    return {
        "service": settings.app_name,
        "version": settings.version,
        "status": "ok",
        "groq_enabled": settings.groq_enabled,
        "gemini_enabled": settings.gemini_enabled,
    }


@app.get("/api/health", tags=["meta"])
async def health():
    return {"status": "healthy", "service": "backend-ai"}