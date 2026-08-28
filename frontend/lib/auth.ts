/**
 * Auth helpers — NextAuth types + role utilities.
 */
import type { Role } from "@shared/types";

export const ROLE_LABELS: Record<Role, string> = {
  INVESTIGATOR: "Investigator",
  DSP: "DSP",
  SP: "SP",
  DGP: "DGP",
};

export const ROLE_LEVELS: Record<Role, number> = {
  INVESTIGATOR: 1,
  DSP: 2,
  SP: 3,
  DGP: 4,
};

export function canAccess(userRole: Role | undefined, minRole: Role): boolean {
  if (!userRole) return false;
  return ROLE_LEVELS[userRole] >= ROLE_LEVELS[minRole];
}

/** Route-level role requirements for the dashboard shell. */
export const routeMinRoles: { prefix: string; minRole: Role }[] = [
  { prefix: "/cross-reference", minRole: "SP" },
  { prefix: "/alerts", minRole: "DSP" },
  { prefix: "/settings", minRole: "INVESTIGATOR" },
];
