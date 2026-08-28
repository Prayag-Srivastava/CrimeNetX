/**
 * CrimeNetX — Express REST API + Socket.io server (port 5000).
 */
import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import { Server as SocketServer } from "socket.io";
import { env } from "./config/env";
import { logger } from "./utils/logger";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { generalLimiter } from "./middleware/rateLimit";

import authRoutes from "./routes/auth.routes";
import caseRoutes from "./routes/cases.routes";
import suspectRoutes from "./routes/suspects.routes";
import evidenceRoutes from "./routes/evidence.routes";
import networkRoutes from "./routes/network.routes";
import alertRoutes from "./routes/alerts.routes";
import analyticsRoutes from "./routes/analytics.routes";
import proxyRoutes from "./routes/proxy.routes";
import dossierRoutes from "./routes/dossier.routes";
import { initAlertSocket } from "./sockets/alertSocket";

const app = express();
const server = http.createServer(app);

// --- Security & parsing ------------------------------------------------------
app.use(helmet());
app.use(
  cors({
    origin: [env.frontendUrl, "http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);

// --- Request logging ---------------------------------------------------------
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
});

// --- Health ------------------------------------------------------------------
app.get("/api/health", (_req, res) => res.json({ status: "healthy", service: "backend-node", time: new Date().toISOString() }));

// --- Routes ------------------------------------------------------------------
app.use("/api/auth", authRoutes);
app.use("/api/cases", caseRoutes);
app.use("/api/suspects", suspectRoutes);
app.use("/api/evidence", evidenceRoutes);
app.use("/api", networkRoutes); // network routes mounted at /api/case/:id/network
app.use("/api/alerts", alertRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api", proxyRoutes); // /api/ai/*
app.use("/api/dossier", dossierRoutes);

// --- Errors ------------------------------------------------------------------
app.use(notFound);
app.use(errorHandler);

// --- Socket.io (real-time alerts) -------------------------------------------
const io = new SocketServer(server, {
  cors: { origin: [env.frontendUrl, "http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  path: "/socket.io",
});
const unsubscribe = initAlertSocket(io);

server.listen(env.port, "0.0.0.0", () => {
  logger.info(`CrimeNetX API listening on :${env.port} (${env.nodeEnv})`);
  logger.info(`AI service URL: ${env.aiServiceUrl}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received — shutting down");
  unsubscribe();
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  unsubscribe();
  server.close(() => process.exit(0));
});
