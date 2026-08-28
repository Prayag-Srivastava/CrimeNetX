/**
 * RBAC middleware — role hierarchy enforcement.
 * Hierarchy: INVESTIGATOR < DSP < SP < DGP
 * A route declares the minimum role required; anyone above also passes.
 */
import { NextFunction, Request, Response } from "express";
import { ApiError } from "./errorHandler";
import { Role, ROLE_LEVEL } from "../types/roles";

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"));
    }
    const userLevel = ROLE_LEVEL[req.user.role];
    const minLevel = Math.min(...roles.map((r) => ROLE_LEVEL[r]));
    if (userLevel < minLevel) {
      return next(
        new ApiError(403, `Access denied — requires role ${roles.join(" or ")} or higher`)
      );
    }
    next();
  };
}

/** Restrict a case to its assigned investigator, or any DSP+ supervisor. */
export async function requireCaseAccess(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user) return next(new ApiError(401, "Authentication required"));
    const caseId = req.params.id;
    if (!caseId) return next();

    // DSP+ can access any case in their jurisdiction; investigators only assigned ones.
    if (req.user.role !== "INVESTIGATOR") return next();

    const { prisma } = await import("../config/prisma");
    const record = await prisma.case.findUnique({ where: { id: caseId } });
    if (!record) return next(new ApiError(404, "Case not found"));
    if (record.assignedInvestigatorId !== req.user.id) {
      return next(new ApiError(403, "Case not assigned to you"));
    }
    next();
  } catch (err) {
    next(err);
  }
}
