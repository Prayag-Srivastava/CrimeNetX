/**
 * Redis client (ioredis) — caching + WebSocket pub/sub.
 * Upstash-compatible via REDIS_URL; degrades to a no-op when unavailable so
 * the API never crashes on a cache outage.
 */
import Redis from "ioredis";
import { env } from "./env";
import { logger } from "../utils/logger";

let redis: Redis | null = null;
let broken = false;

try {
  redis = new Redis(env.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
  });
  redis.on("error", (err) => {
    broken = true;
    logger.warn(`Redis unavailable (${err.message}) — continuing without cache`);
  });
} catch {
  broken = true;
}

export const cache = {
  /** Get JSON value from cache. Returns null on miss/error. */
  async get<T>(key: string): Promise<T | null> {
    if (broken || !redis) return null;
    try {
      const raw = await redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },

  /** Set JSON value with TTL (seconds). */
  async set(key: string, value: unknown, ttlSec = 300): Promise<void> {
    if (broken || !redis) return;
    try {
      await redis.setex(key, ttlSec, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },

  async del(...keys: string[]): Promise<void> {
    if (broken || !redis) return;
    try {
      await redis.del(...keys);
    } catch {
      /* ignore */
    }
  },

  /** Publish an event to a channel (consumed by the WebSocket hub). */
  async publish(channel: string, payload: unknown): Promise<void> {
    if (broken || !redis) return;
    try {
      await redis.publish(channel, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  },

  /** Subscribe to a channel. Returns an unsubscribe function. */
  subscribe(channel: string, onMessage: (data: unknown) => void): () => void {
    if (broken || !redis) return () => undefined;
    const sub = redis.duplicate();
    sub.on("message", (_ch, message) => {
      try {
        onMessage(JSON.parse(message));
      } catch {
        onMessage(message);
      }
    });
    sub.subscribe(channel).catch(() => undefined);
    return () => sub.unsubscribe(channel).catch(() => undefined);
  },
};

export { redis, broken };
