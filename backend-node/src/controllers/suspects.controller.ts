/**
 * Suspects controller — CRUD + kingpin score updates.
 */
import { NextFunction, Request, Response } from "express";
import { GraphRole, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { ApiError } from "../middleware/errorHandler";
import { audit } from "../services/audit.service";
import { createAlert } from "../services/alert.service";

export async function listSuspects(req: Request, res: Response, next: NextFunction) {
  try {
    const caseId = req.params.id as string | undefined;
    const where: Prisma.SuspectWhereInput = caseId ? { cases: { some: { id: caseId } } } : {};
    const data = await prisma.suspect.findMany({
      where,
      orderBy: { kingpinScore: "desc" },
      include: { cases: { select: { id: true, caseNumber: true, title: true } } },
    });
    res.json({ data, total: data.length });
  } catch (err) {
    next(err);
  }
}

export async function getSuspect(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const record = await prisma.suspect.findUnique({
      where: { id },
      include: { cases: { select: { id: true, caseNumber: true, title: true } } },
    });
    if (!record) throw new ApiError(404, "Suspect not found");
    res.json(record);
  } catch (err) {
    next(err);
  }
}

export async function createSuspect(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const caseId = req.params.id as string | undefined;
    const {
      name,
      aliases,
      dob,
      gender,
      address,
      phoneNumbers,
      photoUrl,
      criminalHistory,
      kingpinScore,
      role,
    } = req.body as {
      name?: string;
      aliases?: string[];
      dob?: string;
      gender?: string;
      address?: string;
      phoneNumbers?: string[];
      photoUrl?: string;
      criminalHistory?: string[];
      kingpinScore?: number;
      role?: GraphRole;
    };

    if (!name) throw new ApiError(400, "name is required");

    const data: Prisma.SuspectCreateInput = {
      name,
      aliases: aliases || [],
      dob: dob ? new Date(dob) : undefined,
      gender: gender || "",
      address: address || "",
      phoneNumbers: phoneNumbers || [],
      photoUrl: photoUrl || "",
      criminalHistory: criminalHistory || [],
      kingpinScore: kingpinScore ?? 0,
      role: role || "EXECUTOR",
    };
    if (caseId) {
      data.cases = { connect: { id: caseId } };
    }

    const record = await prisma.suspect.create({ data });
    await audit({ userId: user.id, ipAddress: req.ip }, "SUSPECT_CREATED", "Suspect", record.id, { name });

    // Flag kingpins immediately.
    if ((record.kingpinScore ?? 0) > 70 && caseId) {
      await createAlert({
        caseId,
        type: "HIGH_RISK",
        severity: "HIGH",
        message: `Suspect ${record.name} classified as KINGPIN (score ${record.kingpinScore})`,
        data: { suspectId: record.id, score: record.kingpinScore },
      });
    }
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

export async function updateSuspect(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const { id } = req.params;
    const allowed = [
      "name",
      "aliases",
      "dob",
      "gender",
      "address",
      "phoneNumbers",
      "photoUrl",
      "criminalHistory",
      "kingpinScore",
      "role",
    ];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (req.body.dob !== undefined) patch.dob = req.body.dob ? new Date(req.body.dob) : null;
    if (Object.keys(patch).length === 0) throw new ApiError(400, "No fields to update");

    const record = await prisma.suspect.update({ where: { id }, data: patch as Prisma.SuspectUpdateInput });
    await audit({ userId: user.id, ipAddress: req.ip }, "SUSPECT_UPDATED", "Suspect", id, patch);
    res.json(record);
  } catch (err) {
    next(err);
  }
}

export async function deleteSuspect(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const { id } = req.params;
    await prisma.suspect.delete({ where: { id } });
    await audit({ userId: user.id, ipAddress: req.ip }, "SUSPECT_DELETED", "Suspect", id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
