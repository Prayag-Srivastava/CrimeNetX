/**
 * Alert service — persists alerts and fans them out via Redis pub/sub
 * to the Socket.io hub (see sockets/alertSocket.ts).
 */
import { prisma } from "../config/prisma";
import { cache } from "../config/redis";
import { AlertSeverity, AlertType, CasePriority } from "@prisma/client";

export interface AlertInput {
  caseId: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  data?: Record<string, unknown>;
}

export async function createAlert(input: AlertInput): Promise<void> {
  const alert = await prisma.alert.create({
    data: {
      caseId: input.caseId,
      type: input.type,
      severity: input.severity,
      message: input.message,
      data: (input.data as object) ?? undefined,
    },
  });
  await cache.publish("crimenetx:alerts", {
    event: "alert_created",
    alert: {
      id: alert.id,
      caseId: alert.caseId,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      createdAt: alert.createdAt,
    },
  });
  await cache.del(`alerts:${input.caseId}`);
}

/** Convenience: create a high-severity alert from an anomaly detection run. */
export async function alertOnAnomaly(
  caseId: string,
  anomalies: { transaction_index: number; score: number; is_anomaly: boolean }[],
  launderingRisk?: string
): Promise<void> {
  const flagged = anomalies.filter((a) => a.is_anomaly).length;
  if (flagged === 0 && launderingRisk !== "HIGH" && launderingRisk !== "MEDIUM") return;

  await createAlert({
    caseId,
    type: "ANOMALY",
    severity: launderingRisk === "HIGH" ? "CRITICAL" : launderingRisk === "MEDIUM" ? "HIGH" : "MEDIUM",
    message: `${flagged} suspicious transaction(s) detected${launderingRisk ? ` · laundering risk ${launderingRisk}` : ""}`,
    data: { flagged, launderingRisk },
  });
}

export function severityFromPriority(priority: CasePriority): AlertSeverity {
  switch (priority) {
    case "CRITICAL":
      return "CRITICAL";
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
      return "MEDIUM";
    default:
      return "LOW";
  }
}
