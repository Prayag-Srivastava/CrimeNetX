/**
 * Alerts controller — list + resolve. Alerts are also pushed live via Socket.io.
 */
import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma";
import { ApiError } from "../middleware/errorHandler";
import { audit } from "../services/audit.service";
import { cache } from "../config/redis";

export async function listAlerts(req: Request, res: Response, next: NextFunction) {
  try {
    const caseId = req.params.id as string | undefined;
    const unresolvedOnly = req.query.unresolved === "true";
    const where = {
      ...(caseId ? { caseId } : {}),
      ...(unresolvedOnly ? { resolved: false } : {}),
    };
    const data = await prisma.alert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(200, parseInt(String(req.query.limit || "50"), 10)),
      include: { case: { select: { caseNumber: true, title: true } } },
    });
    const total = await prisma.alert.count({ where });
    res.json({ data, total });
  } catch (err) {
    next(err);
  }
}

export async function resolveAlert(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const { id } = req.params;
    const record = await prisma.alert.update({
      where: { id },
      data: { resolved: true },
    });
    await audit({ userId: user.id, ipAddress: req.ip }, "ALERT_RESOLVED", "Alert", id);
    await cache.del(`alerts:${record.caseId}`);
    res.json(record);
  } catch (err) {
    next(err);
  }
}
