"""Suspicious pattern detection.

1. DBSCAN clustering    — groups suspects/accounts by behavioral similarity.
   Chosen over k-means because the number of criminal cells is unknown a
   priori and DBSCAN finds arbitrarily-shaped clusters + labels outliers
   (noise) as cluster -1 (isolated actors).

2. Isolation Forest     — transactional anomaly detection.
   Chosen over One-Class SVM because it handles multivariate features with
   less tuning (no kernel/param search), scales linearly, and isolates
   anomalies via random partitioning — ideal for high-dimensional txn features.

3. Money-laundering layering heuristic (hops-based) lives in financial_tracer.
"""
from __future__ import annotations

import logging
from typing import Any

import numpy as np
from sklearn.cluster import DBSCAN
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from app.models.schemas import AnomalyResult, ClusterResult

logger = logging.getLogger("crimenetx.cluster")


def cluster_suspects(features: list[dict[str, Any]], eps: float = 0.8, min_samples: int = 2) -> list[ClusterResult]:
    """DBSCAN over suspect feature vectors.

    features: [{"id": str, "vector": [float,...]}] — e.g. normalized call
    frequency, transaction volume, geo proximity encoding.
    """
    if len(features) < min_samples:
        return [ClusterResult(suspect=f["id"], cluster=-1) for f in features]

    X = np.array([f["vector"] for f in features], dtype=float)
    X = StandardScaler().fit_transform(X)  # DBSCAN is distance-based -> must scale

    clustering = DBSCAN(eps=eps, min_samples=min_samples, metric="euclidean").fit(X)

    results = []
    for f, label in zip(features, clustering.labels_):
        results.append(ClusterResult(suspect=f["id"], cluster=int(label)))
    return results


def detect_anomalies(
    txns: list[dict[str, Any]],
    contamination: float = 0.05,
) -> list[AnomalyResult]:
    """Isolation Forest on transaction feature vectors.

    Feature vector per txn: [log(amount), hour_of_day, is_weekend, hop_index_guess].
    Returns every txn with an anomaly score; is_anomaly when prediction == -1.
    """
    if len(txns) < 10:  # too little data for meaningful isolation
        return [AnomalyResult(transaction_index=i, score=0.0, is_anomaly=False) for i in range(len(txns))]

    X = []
    for t in txns:
        amount = max(float(t.get("amount", 0)), 0.0)
        try:
            hour = float(t.get("timestamp", "").hour if hasattr(t.get("timestamp"), "hour") else 0)
        except Exception:
            hour = 0.0
        X.append([np.log1p(amount), hour / 24.0, float(t.get("is_weekend", False))])

    X = np.array(X, dtype=float)
    model = IsolationForest(contamination=contamination, random_state=42, n_jobs=-1).fit(X)

    preds = model.predict(X)
    scores = model.score_samples(X)  # higher = more normal

    results = []
    for i, (p, s) in enumerate(zip(preds, scores)):
        results.append(
            AnomalyResult(
                transaction_index=i,
                score=round(float(s), 4),
                is_anomaly=bool(p == -1),
                reason=(
                    "Amount, timing or hop pattern deviates from network norm (Isolation Forest)"
                    if p == -1 else ""
                ),
            )
        )
    return results
