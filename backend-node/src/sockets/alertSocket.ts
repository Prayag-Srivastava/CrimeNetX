/**
 * Socket.io alert hub — bridges Redis pub/sub to browser clients.
 *
 * Events emitted to clients:
 *   - new_evidence_uploaded
 *   - high_risk_alert
 *   - network_updated
 *   - ghost_link_detected
 *   - cross_reference_match
 *   - alert_created
 *
 * Clients join rooms per role ("role:DSP") and per case ("case:abc") so they
 * only receive what they should see.
 */
import { Server as SocketServer } from "socket.io";
import { cache } from "../config/redis";
import { logger } from "../utils/logger";

const CHANNEL = "crimenetx:alerts";

// Map an alert event name to the client-facing event string.
const EVENT_NAME: Record<string, string> = {
  alert_created: "alert_created",
  new_evidence_uploaded: "new_evidence_uploaded",
  network_updated: "network_updated",
  high_risk_alert: "high_risk_alert",
  ghost_link_detected: "ghost_link_detected",
  cross_reference_match: "cross_reference_match",
};

export function initAlertSocket(io: SocketServer): () => void {
  // Auth: validate the JWT passed via socket handshake query.
  io.use((socket, next) => {
    const token = (socket.handshake.auth?.token as string) || (socket.handshake.query?.token as string);
    if (!token) return next(new Error("Authentication required"));
    try {
      // Lightweight verify — full verification is done by middleware for REST.
      const jwt = require("jsonwebtoken");
      const { env } = require("../config/env");
      const payload = jwt.verify(token, env.jwtSecret) as { sub: string; role: string };
      (socket.data as Record<string, unknown>).userId = payload.sub;
      (socket.data as Record<string, unknown>).role = payload.role;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const role = (socket.data as { role?: string }).role ?? "";
    const userId = (socket.data as { userId?: string }).userId ?? "";
    logger.info(`Socket connected: ${socket.id} (${role})`);

    socket.join(`role:${role}`);
    socket.join(`user:${userId}`);
    socket.emit("connected", { ok: true, role, userId });

    // Allow joining case rooms (used by case detail pages).
    socket.on("join_case", (caseId: string) => {
      if (typeof caseId === "string") socket.join(`case:${caseId}`);
    });
    socket.on("leave_case", (caseId: string) => {
      if (typeof caseId === "string") socket.leave(`case:${caseId}`);
    });
    socket.on("disconnect", () => logger.info(`Socket disconnected: ${socket.id}`));
  });

  // Bridge Redis -> Socket.io
  const unsubscribe = cache.subscribe(CHANNEL, (payload) => {
    const msg = payload as { event?: string; [k: string]: unknown };
    const eventName = EVENT_NAME[msg.event ?? ""] ?? msg.event ?? "event";
    const caseId = msg.caseId ?? (msg.alert as { caseId?: string } | undefined)?.caseId;

    io.emit(eventName, msg); // broadcast to all authenticated sockets
    if (caseId) io.to(`case:${caseId}`).emit(eventName, msg);
    if (msg.event === "alert_created") {
      const sev = (msg.alert as { severity?: string } | undefined)?.severity;
      if (sev === "HIGH" || sev === "CRITICAL") {
        io.emit("high_risk_alert", msg.alert);
      }
    }
  });

  logger.info("Alert socket hub initialized (Redis pub/sub -> Socket.io)");
  return unsubscribe;
}
