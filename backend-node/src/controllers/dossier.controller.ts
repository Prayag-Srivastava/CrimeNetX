/**
 * Dossier controller — orchestrates PDF generation via the AI service,
 * records the Dossier row, and streams the PDF to the client.
 */
import path from "path";
import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma";
import { ApiError } from "../middleware/errorHandler";
import { env } from "../config/env";
import { audit } from "../services/audit.service";
import { createAlert } from "../services/alert.service";
import { logger } from "../utils/logger";

export async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const { caseId } = req.params;
    const overrides = (req.body as { sections?: Record<string, unknown>; evidence_qr_payload?: string }) ?? {};

    const record = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        assignedInvestigator: { select: { name: true } },
        entities: { take: 200 },
        nodes: { take: 200 },
        transactions: { orderBy: { timestamp: "asc" }, take: 500 },
        evidence: { orderBy: { uploadedAt: "asc" }, take: 200 },
        alerts: { orderBy: { createdAt: "asc" }, take: 100 },
      },
    });
    if (!record) throw new ApiError(404, "Case not found");

    // Fetch AI-side enrichments (kingpin scores already live on nodes).
    const aiResp = await fetch(`${env.aiServiceUrl}/api/dossier/generate/${caseId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        case: {
          id: record.id,
          caseNumber: record.caseNumber,
          title: record.title,
          description: record.description,
          jurisdiction: record.jurisdiction,
          priority: record.priority,
          status: record.status,
          assignedInvestigator: record.assignedInvestigator?.name ?? "—",
        },
        sections: {
          entities: record.entities,
          kingpin_scores: record.nodes.map((n) => ({
            entity_id: n.id,
            label: n.label,
            composite: n.kingpinScore,
            role: n.role,
            pagerank: (n.centrality as Record<string, number> | null)?.pagerank ?? 0,
            betweenness: (n.centrality as Record<string, number> | null)?.betweenness ?? 0,
          })),
          timeline: [
            ...record.evidence.map((e) => ({ timestamp: e.uploadedAt, event: `${e.type} evidence: ${e.fileName}` })),
            ...record.alerts.map((a) => ({ timestamp: a.createdAt, event: `Alert: ${a.message}` })),
          ],
          financial: {
            trail: record.transactions.map((t) => ({
              from_account: t.fromAccount,
              to_account: t.toAccount,
              amount: t.amount,
              timestamp: t.timestamp,
            })),
          },
          ipc_sections: ["Section 173 CrPC (case diary)", "Section 65B Evidence Act (electronic records)", "Relevant IPC/BNS sections per charge sheet"],
          next_steps: ["Verify evidence chain of custody hashes", "Corroborate CDR tower data with geo-location", "Arrange suspect identification parade", "Coordinate with forensic lab for digital evidence"],
        },
        evidence_qr_payload: overrides.evidence_qr_payload ?? `CRIMENETX|${record.caseNumber}|${Date.now()}`,
      }),
    });
    if (!aiResp.ok) throw new ApiError(502, "AI dossier generation failed");

    const result = (await aiResp.json()) as {
      s3_url: string;
      local_path: string;
      page_count: number;
      sha256_hash: string;
    };

    const dossier = await prisma.dossier.create({
      data: {
        caseId,
        generatedBy: user.id,
        s3Url: result.s3_url || "",
        localPath: result.local_path || "",
        sha256Hash: result.sha256_hash || "",
        pageCount: result.page_count || 0,
      },
    });

    await audit(
      { userId: user.id, ipAddress: req.ip },
      "DOSSIER_GENERATED",
      "Dossier",
      dossier.id,
      { caseId, pages: dossier.pageCount, hash: dossier.sha256Hash }
    );
    await createAlert({
      caseId,
      type: "NETWORK_UPDATE",
      severity: "INFO",
      message: `Investigation dossier generated (${dossier.pageCount} pages, SHA-256 ${dossier.sha256Hash.slice(0, 8)}…)`,
      data: { dossierId: dossier.id },
    });

    res.status(201).json(dossier);
  } catch (err) {
    next(err);
  }
}

export async function download(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    const dossier = await prisma.dossier.findUnique({
      where: { id },
    });

    if (!dossier) {
      throw new ApiError(404, "Dossier not found");
    }

    if (!dossier.localPath) {
      throw new ApiError(404, "Dossier PDF path not available");
    }

    // The AI service stores the PDF inside its own container.
    // Only send the filename to the AI download endpoint.
    const filename = path.basename(dossier.localPath);

    const aiUrl =
      `${env.aiServiceUrl}/api/dossier/download/${encodeURIComponent(filename)}`;

    const aiResp = await fetch(aiUrl);

    if (!aiResp.ok) {
      const body = await aiResp.text().catch(() => "");
      logger.error(
        `AI dossier download failed: ${aiResp.status} ${body}`
      );

      throw new ApiError(502, "Unable to retrieve dossier PDF");
    }

    const contentType =
      aiResp.headers.get("content-type") || "application/pdf";

    const arrayBuffer = await aiResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${filename}"`
    );
    res.setHeader("Content-Length", buffer.length);

    res.send(buffer);
  } catch (err) {
    next(err);
  }
}
