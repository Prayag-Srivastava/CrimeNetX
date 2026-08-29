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

    const contentType = req.headers["content-type"] || "";
    const isMultipart = contentType.toLowerCase().startsWith("multipart/form-data");

    const headers: Record<string, string> = {};

    if (contentType) {
      headers["Content-Type"] = String(contentType);
    }

    if (req.headers.authorization) {
      headers.Authorization = String(req.headers.authorization);
    }

    if (req.headers["content-length"]) {
      headers["Content-Length"] = String(req.headers["content-length"]);
    }

    const fetchOptions: RequestInit & { duplex?: "half" } = {
      method: req.method,
      headers,
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      if (isMultipart) {
        // Forward the original multipart stream unchanged.
        fetchOptions.body = req as any;
        fetchOptions.duplex = "half";
      } else {
        fetchOptions.body = JSON.stringify(req.body ?? {});
      }
    }

    const resp = await fetch(url, fetchOptions);

    const responseContentType =
      resp.headers.get("content-type") || "application/json";

    if (responseContentType.includes("text/event-stream")) {
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

    res.status(resp.status).type(responseContentType).send(body);
  } catch (err) {
    logger.error("AI proxy failed", err as Error);
    next(new ApiError(502, "AI service unreachable"));
  }
}
