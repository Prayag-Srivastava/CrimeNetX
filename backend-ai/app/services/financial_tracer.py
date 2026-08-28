"""Financial Money-Flow Tracer.

- Builds a weighted directed graph from the Transaction table.
- shortest_path (weight = 1/log(amount) so large transfers are 'closer') from
  a victim/source account to the final destination.
- Layering detection: any path > 3 hops from source->sink is a classic
  money-laundering red flag (layering = breaking big sums into many hops).
"""
from __future__ import annotations

import logging
import math
from typing import Any

import networkx as nx

from app.models.schemas import LaunderingRisk, TraceResult

logger = logging.getLogger("crimenetx.finance")

LAYERING_HOPS_THRESHOLD = 3


def build_txn_graph(txns: list[dict[str, Any]]) -> nx.DiGraph:
    g = nx.DiGraph()
    for t in txns:
        src, tgt = str(t.get("from_account")), str(t.get("to_account"))
        if not src or not tgt:
            continue
        amount = max(float(t.get("amount", 0.0)), 0.01)
        # Edge weight: smaller weight == stronger connection. log transform
        # compresses huge vs small transfers so the path cost is dominated by
        # hop count but still favors large-value edges.
        w = 1.0 / math.log1p(amount)
        if g.has_edge(src, tgt):
            g[src][tgt]["weight"] = min(g[src][tgt]["weight"], w)
            g[src][tgt]["total"] += amount
        else:
            g.add_edge(src, tgt, weight=w, total=amount)
    return g


def trace_flow(source_account: str, target_account: str, txns: list[dict[str, Any]], max_depth: int = 6) -> TraceResult:
    g = build_txn_graph(txns)
    if source_account not in g or target_account not in g:
        return TraceResult(path=[], hops=0, found=False, layering_risk="LOW")

    try:
        # Bellman-Ford handles the (potential) negative-ish weights better than
        # Dijkstra; with positive weights Dijkstra is exact — use Dijkstra.
        path = nx.dijkstra_path(g, source_account, target_account, weight="weight")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return TraceResult(path=[], hops=0, found=False, layering_risk="LOW")

    hops = max(0, len(path) - 1)
    # Layering definition: >3 hops between source and sink is a classic
    # money-laundering red flag (FATF-style guidance); >4 hops is aggravated.
    layering = (
        "HIGH"
        if hops > LAYERING_HOPS_THRESHOLD + 1
        else "MEDIUM"
        if hops > LAYERING_HOPS_THRESHOLD
        else "LOW"
    )
    return TraceResult(path=path, hops=hops, found=True, layering_risk=layering)


def laundering_risk(case_id: str, txns: list[dict[str, Any]]) -> LaunderingRisk:
    """Scan all source->sink paths for layering and flag suspicious txns."""
    g = build_txn_graph(txns)
    sources = [n for n in g.nodes if g.in_degree(n) == 0]
    sinks = [n for n in g.nodes if g.out_degree(n) == 0]

    layered_paths = 0
    max_hops = 0
    for s in sources:
        for t in sinks:
            if s == t:
                continue
            try:
                path = nx.dijkstra_path(g, s, t, weight="weight")
            except nx.NetworkXNoPath:
                continue
            hops = len(path) - 1
            max_hops = max(max_hops, hops)
            if hops > LAYERING_HOPS_THRESHOLD:
                layered_paths += 1

    risk = (
        "HIGH"
        if layered_paths >= 3 or max_hops > LAYERING_HOPS_THRESHOLD + 1
        else "MEDIUM"
        if layered_paths >= 1 or max_hops > LAYERING_HOPS_THRESHOLD
        else "LOW"
    )
    return LaunderingRisk(
        case_id=case_id,
        risk_level=risk,
        layered_paths=layered_paths,
        max_layering_hops=max_hops,
        flagged_transactions=[],
    )
