/**
 * Analytics controller — role-aware dashboards.
 * Investigator: own cases. DSP: district. SP: multi-district. DGP: state-wide.
 */
import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma";
import { cache } from "../config/redis";

export async function dashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const cacheKey = `dashboard:${user.role}:${user.id}`;
    const cached = await cache.get<unknown>(cacheKey);
    if (cached) return res.json(cached);

    const baseCaseWhere =
      user.role === "INVESTIGATOR"
        ? { assignedInvestigatorId: user.id }
        : user.role === "DSP"
          ? { jurisdiction: user.department || "" }
          : {};

    const [totalCases, openCases, highPriority, suspects, evidenceCount, alerts, kingpins, byStatus, byPriority] =
      await Promise.all([
        prisma.case.count({ where: baseCaseWhere }),
        prisma.case.count({ where: { ...baseCaseWhere, status: { in: ["OPEN", "UNDER_INVESTIGATION"] } } }),
        prisma.case.count({ where: { ...baseCaseWhere, priority: { in: ["HIGH", "CRITICAL"] } } }),
        prisma.suspect.count({
          where: user.role === "INVESTIGATOR" ? { cases: { some: { assignedInvestigatorId: user.id } } } : {},
        }),
        prisma.evidence.count({ where: { case: baseCaseWhere } }),
        prisma.alert.count({ where: { case: baseCaseWhere, resolved: false } }),
        prisma.networkNode.count({ where: { role: "KINGPIN", case: baseCaseWhere } }),
        prisma.case.groupBy({ by: ["status"], where: baseCaseWhere, _count: true }),
        prisma.case.groupBy({ by: ["priority"], where: baseCaseWhere, _count: true }),
      ]);

    const payload = {
      role: user.role,
      kpis: {
        totalCases,
        openCases,
        highPriority,
        suspects,
        evidenceCount,
        unresolvedAlerts: alerts,
        kingpins,
      },
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      byPriority: byPriority.map((p) => ({ priority: p.priority, count: p._count })),
      generatedAt: new Date().toISOString(),
    };
    await cache.set(cacheKey, payload, 60);
    res.json(payload);
  } catch (err) {
    next(err);
  }
}

/** Top kingpins across all cases (DGP/SP view). */
export async function topKingpins(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(50, parseInt(String(req.query.limit || "10"), 10));
    const data = await prisma.suspect.findMany({
      where: { kingpinScore: { gt: 50 } },
      orderBy: { kingpinScore: "desc" },
      take: limit,
      include: { cases: { select: { id: true, caseNumber: true, title: true } } },
    });
    res.json({ data, total: data.length });
  } catch (err) {
    next(err);
  }
}

/** Case load per district — state overview for SP/DGP. */
export async function districtOverview(_req: Request, res: Response, next: NextFunction) {
  try {
    const groups = await prisma.case.groupBy({
      by: ["jurisdiction"],
      _count: { _all: true },
      orderBy: { _count: { jurisdiction: "desc" } },
    });
    res.json({ data: groups.map((g) => ({ jurisdiction: g.jurisdiction || "Unknown", count: g._count._all })) });
  } catch (err) {
    next(err);
  }
}
