/**
 * Shared role types + hierarchy.
 */
import { Role as PrismaRole } from "@prisma/client";

export type Role = PrismaRole;

/** Higher number = higher clearance. Used by requireRole to allow escalation. */
export const ROLE_LEVEL: Record<Role, number> = {
  INVESTIGATOR: 1,
  DSP: 2,
  SP: 3,
  DGP: 4,
};
