/**
 * Proxy controller — forwards AI requests to the FastAPI service.
 * The browser talks to one origin (backend-node) which proxies to :8000,
 * keeping CORS simple and secrets server-side.
 */
import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";
import { logger } from "../utils/logger";

export async function proxyToAI(req: Request, res: Response, next: NextFunction) {
  try {
    const targetPath = req.params[0] || "";
    const url = `${env.aiServiceUrl}/api/${targetPath}`;
    const headers: Record<string, string> = {
      "Content-Type": req.headers["content-type"] || "application/json",
    };
    if (req.headers.authorization) headers.Authorization = String(req.headers.authorization);

    const resp = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body ?? {}),
    });

    const contentType = resp.headers.get("content-type") || "application/json";
    if (contentType.includes("text/event-stream")) {
      // Stream SSE through verbatim.
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.flushHeaders();
      const reader = resp.body?.getReader();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      }
      res.end();
      return;
    }

    const body = await resp.text();
    res.status(resp.status).type(contentType).send(body);
  } catch (err) {
    logger.error("AI proxy failed", err as Error);
    next(new ApiError(502, "AI service unreachable"));
  }
}
