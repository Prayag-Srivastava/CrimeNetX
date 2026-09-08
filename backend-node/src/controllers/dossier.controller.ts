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

interface GenerateDossierBody {
  language?: string;
  sections?: Record<string, unknown>;
  evidence_qr_payload?: string;
}

export async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const { caseId } = req.params;
    const body = (req.body as GenerateDossierBody) ?? {};
    const language = body.language || "en";

    const record = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        assignedInvestigator: { select: { name: true, email: true } },
        entities: { take: 200 },
        nodes: { take: 200 },
        transactions: { orderBy: { timestamp: "asc" }, take: 500 },
        evidence: { orderBy: { uploadedAt: "asc" }, take: 200 },
        alerts: { orderBy: { createdAt: "asc" }, take: 100 },
      },
    });
    if (!record) throw new ApiError(404, "Case not found");

    // Forward payload with selected language to Python AI service
    const aiResp = await fetch(`${env.aiServiceUrl}/api/dossier/generate/${caseId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language,
        case: {
          id: record.id,
          caseNumber: record.caseNumber,
          title: record.title,
          description: record.description,
          jurisdiction: record.jurisdiction,
          priority: record.priority,
          status: record.status,
          startDate: record.startDate,
          createdAt: record.createdAt,
          assignedInvestigator: record.assignedInvestigator?.name ?? "Insp. Aarav Deshpande",
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
          ipc_sections: [
            "Section 173 CrPC / Sec 193 BNSS (Final Police Report)",
            "Section 65B Indian Evidence Act / Sec 63 BSA (Electronic Evidence)",
            "Section 379, 420, 120-B IPC / BNS Correlated",
          ],
          next_steps: [
            "Verify evidence chain of custody hashes",
            "Corroborate CDR tower triangulation with physical site log",
            "Produce formal charge sheet before the Judicial Magistrate",
          ],
        },
        evidence_qr_payload: body.evidence_qr_payload ?? `CRIMENETX|${record.caseNumber}|${language.toUpperCase()}|${Date.now()}`,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text().catch(() => "");
      logger.error(`AI dossier generation failed (${aiResp.status}): ${errText}`);
      throw new ApiError(502, "AI dossier generation failed");
    }

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
      { caseId, pages: dossier.pageCount, hash: dossier.sha256Hash, language }
    );

    await createAlert({
      caseId,
      type: "NETWORK_UPDATE",
      severity: "INFO",
      message: `Charge Sheet generated in ${language.toUpperCase()} (${dossier.pageCount} pages, SHA-256 ${dossier.sha256Hash.slice(0, 8)}…)`,
      data: { dossierId: dossier.id, language },
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

    if (!dossier || !dossier.localPath) {
      throw new ApiError(404, "Dossier PDF record not found");
    }

    const filename = path.basename(dossier.localPath);
    const aiUrl = `${env.aiServiceUrl}/api/dossier/download/${encodeURIComponent(filename)}`;

    const aiResp = await fetch(aiUrl);
    if (!aiResp.ok) {
      throw new ApiError(502, "Unable to retrieve dossier PDF from AI storage");
    }

    const contentType = aiResp.headers.get("content-type") || "application/pdf";
    const arrayBuffer = await aiResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);

    res.send(buffer);
  } catch (err) {
    next(err);
  }
}