"""Redis client — caching + cross-service pub/sub for real-time signals.

The Node backend is the WebSocket hub; FastAPI publishes analysis events to
channels that backend-node subscribes to and broadcasts to browsers.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any

import redis

from app.config import settings

logger = logging.getLogger("crimenetx.redis")


@lru_cache
def get_redis() -> redis.Redis:
    return redis.Redis.from_url(settings.redis_url, decode_responses=True)


def publish_event(channel: str, payload: dict[str, Any]) -> bool:
    """Publish a JSON event to a Redis channel (consumed by backend-node)."""
    try:
        r = get_redis()
        r.publish(channel, json.dumps(payload, default=str))
        return True
    except Exception as exc:
        logger.warning("redis publish failed (%s)", exc)
        return False


def cache_get(key: str) -> Any | None:
    try:
        r = get_redis()
        raw = r.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


def cache_set(key: str, value: Any, ttl: int = 300) -> bool:
    try:
        r = get_redis()
        r.setex(key, ttl, json.dumps(value, default=str))
        return True
    except Exception:
        return False


def cache_delete(*keys: str) -> None:
    try:
        get_redis().delete(*keys)
    except Exception:
        pass
