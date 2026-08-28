/**
 * Central error handler + ApiError class.
 */
import { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger";

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: "Route not found" });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }

  // Prisma known errors
  const prismaErr = err as { code?: string; meta?: { target?: string[] } };
  if (prismaErr?.code === "P2002") {
    return res.status(409).json({ error: "Duplicate record", fields: prismaErr.meta?.target });
  }
  if (prismaErr?.code === "P2025") {
    return res.status(404).json({ error: "Record not found" });
  }

  logger.error("Unhandled error", err instanceof Error ? err : new Error(String(err)));
  return res.status(500).json({ error: "Internal server error" });
}
