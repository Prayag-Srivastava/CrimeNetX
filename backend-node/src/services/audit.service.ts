/**
 * Audit logging — every sensitive action (evidence upload, dossier generation,
 * suspect modification, role changes) is persisted with actor + IP.
 */
import { prisma } from "../config/prisma";
import { logger } from "../utils/logger";

export interface AuditContext {
  userId: string;
  ipAddress?: string;
}

export async function audit(
  ctx: AuditContext,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        action,
        entityType,
        entityId,
        ipAddress: ctx.ipAddress || "",
        metadata: (metadata as object) ?? undefined,
      },
    });
  } catch (err) {
    logger.error("audit write failed", err as Error);
  }
}
