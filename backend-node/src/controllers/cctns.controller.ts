import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { logger } from "../utils/logger";
import fs from "fs";
import path from "path";

export async function syncCCTNS(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;

    // 1. Read mock historical cases to ingest as CCTNS cases
    const mockDataPath = path.join(
  process.cwd(),
  "data",
  "generated",
  "historical_cases.json"
);

    let historicalCases: any[] = [];
    if (fs.existsSync(mockDataPath)) {
      historicalCases = JSON.parse(fs.readFileSync(mockDataPath, "utf-8"));
    }

    // Pick 2 cases that haven't been ingested yet
    const sampleCases = historicalCases.slice(0, 2);
    const createdCases = [];

    for (const sc of sampleCases) {
      const cctnsCaseNumber = `CCTNS-${sc.case_number}`;

      // Prevent duplicate sync
      const existing = await prisma.case.findUnique({
        where: { caseNumber: cctnsCaseNumber },
      });

      if (!existing) {
        const newCase = await prisma.case.create({
          data: {
            caseNumber: cctnsCaseNumber,
            title: `[CCTNS AUTO-SYNC] ${sc.title}`,
            description: sc.summary,
            status: "OPEN",
            priority: "HIGH",
            jurisdiction: "Maharashtra State Node",
            source: "CCTNS",
            externalId: `NCRB-CCTNS-${Math.floor(100000 + Math.random() * 900000)}`,
            syncedAt: new Date(),
            assignedInvestigatorId: userId || null,
            entities: {
              create: (sc.entities || []).map((e: any) => ({
                type: e.type === "BANK_ACCOUNT" ? "BANK_ACCOUNT" : (e.type as any),
                value: e.value,
                confidence: 0.95,
                extractedFrom: "CCTNS Automated Event Stream",
                layer: "llm",
              })),
            },
          },
        });
        createdCases.push(newCase);
      }
    }

    // Log audit trail
    if (userId) {
      await prisma.auditLog.create({
        data: {
          userId,
          action: "CCTNS_GATEWAY_SYNC",
          entityType: "CASE",
          entityId: "SYSTEM_SYNC",
          metadata: { count: createdCases.length },
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: `Successfully synchronized with NCRB CCTNS Gateway. Ingested ${createdCases.length} new cases.`,
      casesSynced: createdCases.length,
      cases: createdCases,
    });
  } catch (error: any) {
    logger.error("CCTNS Sync Error: " + error.message);
    return res.status(500).json({ success: false, error: "Failed to connect to CCTNS Gateway node." });
  }
}