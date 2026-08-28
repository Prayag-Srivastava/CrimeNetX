/**
 * Cases controller — CRUD with RBAC-aware scoping.
 * Investigators see only assigned cases; DSP+ see jurisdiction-wide data.
 */
import { NextFunction, Request, Response } from "express";
import { Prisma, CasePriority, CaseStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { ApiError } from "../middleware/errorHandler";
import { audit } from "../services/audit.service";
import { createAlert, severityFromPriority } from "../services/alert.service";

export async function listCases(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || "20"), 10)));
    const status = req.query.status as CaseStatus | undefined;
    const search = String(req.query.search || "");

    const where: Prisma.CaseWhereInput = {};
    if (user.role === "INVESTIGATOR") {
      where.assignedInvestigatorId = user.id;
    }
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { caseNumber: { contains: search, mode: "insensitive" } },
        { title: { contains: search, mode: "insensitive" } },
        { jurisdiction: { contains: search, mode: "insensitive" } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.case.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { assignedInvestigator: { select: { id: true, name: true, email: true } } },
      }),
      prisma.case.count({ where }),
    ]);

    res.json({ data, total, page, pageSize });
  } catch (err) {
    next(err);
  }
}

export async function getCase(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const record = await prisma.case.findUnique({
      where: { id },
      include: {
        assignedInvestigator: { select: { id: true, name: true, email: true, badgeNumber: true } },
        suspects: true,
        evidence: { orderBy: { uploadedAt: "desc" }, take: 50 },
        transactions: { orderBy: { timestamp: "desc" }, take: 200 },
        alerts: { orderBy: { createdAt: "desc" }, take: 20 },
        entities: { orderBy: { createdAt: "desc" }, take: 200 },
        nodes: { take: 100 },
        edges: { take: 300 },
      },
    });
    if (!record) throw new ApiError(404, "Case not found");
    res.json(record);
  } catch (err) {
    next(err);
  }
}

export async function createCase(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const { caseNumber, title, description, status, priority, jurisdiction, assignedInvestigatorId } = req.body as {
      caseNumber?: string;
      title?: string;
      description?: string;
      status?: CaseStatus;
      priority?: CasePriority;
      jurisdiction?: string;
      assignedInvestigatorId?: string;
    };

    if (!caseNumber || !title) throw new ApiError(400, "caseNumber and title are required");

    const record = await prisma.case.create({
      data: {
        caseNumber,
        title,
        description: description || "",
        status: status || "OPEN",
        priority: priority || "MEDIUM",
        jurisdiction: jurisdiction || "",
        assignedInvestigatorId: assignedInvestigatorId || user.id,
      },
    });

    await audit({ userId: user.id, ipAddress: req.ip }, "CASE_CREATED", "Case", record.id, { caseNumber });

    // High-priority cases generate an alert for supervisors.
    if (priority === "HIGH" || priority === "CRITICAL") {
      await createAlert({
        caseId: record.id,
        type: "HIGH_RISK",
        severity: severityFromPriority(priority as CasePriority),
        message: `New ${priority} priority case registered: ${record.caseNumber}`,
        data: { caseId: record.id },
      });
    }

    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

export async function updateCase(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const { id } = req.params;
    const allowed = [
      "title",
      "description",
      "status",
      "priority",
      "jurisdiction",
      "assignedInvestigatorId",
    ];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (Object.keys(patch).length === 0) throw new ApiError(400, "No fields to update");

    const record = await prisma.case.update({ where: { id }, data: patch as Prisma.CaseUpdateInput });
    await audit({ userId: user.id, ipAddress: req.ip }, "CASE_UPDATED", "Case", id, patch);
    res.json(record);
  } catch (err) {
    next(err);
  }
}

export async function deleteCase(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const { id } = req.params;
    await prisma.case.delete({ where: { id } });
    await audit({ userId: user.id, ipAddress: req.ip }, "CASE_DELETED", "Case", id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function caseStats(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const [evidence, entities, transactions, alerts, nodes, edges, suspects] = await Promise.all([
      prisma.evidence.count({ where: { caseId: id } }),
      prisma.entity.count({ where: { caseId: id } }),
      prisma.transaction.count({ where: { caseId: id } }),
      prisma.alert.count({ where: { caseId: id } }),
      prisma.networkNode.count({ where: { caseId: id } }),
      prisma.networkEdge.count({ where: { caseId: id } }),
      prisma.suspect.count({ where: { cases: { some: { id } } } }),
    ]);
    res.json({ evidence, entities, transactions, alerts, nodes, edges, suspects });
  } catch (err) {
    next(err);
  }
}
