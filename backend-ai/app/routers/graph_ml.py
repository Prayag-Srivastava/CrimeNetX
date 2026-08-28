"""Graph ML endpoints — build network, kingpin scores, link prediction, clustering."""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field

from app.models.schemas import (
    ClusterResult,
    LinkPredictionResponse,
    NetworkGraph,
)
from app.services import graph_analyzer as ga
from app.services.link_predictor import predict

router = APIRouter(prefix="/api/graph", tags=["Graph ML"])


class GraphBuildRequest(BaseModel):
    case_id: str
    entities: list[dict[str, Any]] = Field(default_factory=list)
    relations: list[dict[str, Any]] = Field(default_factory=list)


class PredictRequest(GraphBuildRequest):
    threshold: float = 0.15


class ClusterRequest(BaseModel):
    case_id: str = ""
    suspects: list[dict[str, Any]] = Field(default_factory=list)  # [{id, vector}]
    eps: float = 0.8
    min_samples: int = 2


@router.post("/build/{case_id}", response_model=NetworkGraph)
async def build(case_id: str, payload: GraphBuildRequest | None = Body(default=None)):
    """Build the directed network graph and compute kingpin scores."""
    data = payload or GraphBuildRequest(case_id=case_id, entities=[], relations=[])
    if data.case_id != case_id:
        data.case_id = case_id
    return ga.analyze(case_id, data.entities, data.relations)


@router.get("/kingpin-scores/{case_id}")
async def kingpin_scores(case_id: str, payload: GraphBuildRequest | None = None):
    if payload is None:
        raise HTTPException(400, "Provide entities/relations in body (POST) to compute scores")
    g, meta = ga.build_graph(case_id, payload.entities, payload.relations)
    scores = ga.compute_kingpin_scores(g)
    return [
        {
            "entity_id": nid,
            "label": meta.get(nid, {}).get("label", nid),
            "pagerank": s.pagerank,
            "betweenness": s.betweenness,
            "degree": s.degree,
            "eigenvector": s.eigenvector,
            "composite": s.composite,
            "role": s.role.value,
        }
        for nid, s in scores.items()
    ]


@router.post("/kingpin-scores/{case_id}")
async def kingpin_scores_post(case_id: str, payload: GraphBuildRequest):
    g, meta = ga.build_graph(case_id, payload.entities, payload.relations)
    scores = ga.compute_kingpin_scores(g)
    return [
        {
            "entity_id": nid,
            "label": meta.get(nid, {}).get("label", nid),
            "pagerank": s.pagerank,
            "betweenness": s.betweenness,
            "degree": s.degree,
            "eigenvector": s.eigenvector,
            "composite": s.composite,
            "role": s.role.value,
        }
        for nid, s in scores.items()
    ]


@router.post("/predict-links/{case_id}", response_model=LinkPredictionResponse)
async def predict_links(case_id: str, payload: PredictRequest):
    """Ghost Link predictions — hidden relationships an investigator should probe."""
    return predict(case_id, payload.entities, payload.relations, payload.threshold)


@router.post("/cluster-suspects/{case_id}", response_model=list[ClusterResult])
async def cluster_suspects(case_id: str, payload: ClusterRequest):
    from app.services.cluster_analyzer import cluster_suspects as run_cluster

    return run_cluster(payload.suspects, eps=payload.eps, min_samples=payload.min_samples)


@router.get("/metrics/{case_id}")
async def network_metrics(case_id: str, payload: GraphBuildRequest | None = None):
    """Return network-level metrics (density, components, communities)."""
    if payload is None:
        raise HTTPException(400, "Provide entities/relations in body")
    g, meta = ga.build_graph(case_id, payload.entities, payload.relations)
    communities = ga.community_detection(g.to_undirected())
    return {
        "case_id": case_id,
        "node_count": g.number_of_nodes(),
        "edge_count": g.number_of_edges(),
        "density": round(ga.nx.density(g), 4),
        "connected_components": ga.nx.number_weakly_connected_components(g),
        "communities": len(set(communities.values())) if communities else 0,
    }
