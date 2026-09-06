/**
 * Chat controller — bundles case context from Prisma and proxies the query
 * (with SSE streaming) to the AI backend's /api/chat/query endpoint.
 */
import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { ApiError } from "../middleware/errorHandler";
import fs from "fs";
import path from "path";

interface ChatMessageIn {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ChatQueryBody {
  question: string;
  caseId?: string | null;
  conversationId?: string | null;
  history?: ChatMessageIn[];
}

/**
 * Automatically searches for a matching case in the database based on keywords in the question.
 */
async function autoDetectCase(question: string): Promise<string | null> {
  const q = question.toLowerCase();

  const cases = await prisma.case.findMany({
    select: { id: true, caseNumber: true, title: true, jurisdiction: true, description: true },
  });

  for (const c of cases) {
    const cNum = c.caseNumber.toLowerCase();
    const title = c.title.toLowerCase();
    const jur = c.jurisdiction.toLowerCase();

    if (
      (cNum && q.includes(cNum)) ||
      (q.includes("hinjewadi") && (title.includes("hinjewadi") || jur.includes("hinjewadi") || jur.includes("pune"))) ||
      (q.includes("snatching") && title.includes("snatching")) ||
      (q.includes("ransomware") && title.includes("ransomware")) ||
      (q.includes("passport") && title.includes("passport")) ||
      (q.includes("arms") && title.includes("arms")) ||
      (q.includes("pune") && jur.includes("pune"))
    ) {
      return c.id;
    }
  }

  return null;
}

/**
 * Build the ChatContextBundle from Postgres for a given case.
 */
async function buildCaseContext(caseId: string, user: { id: string; role: string }) {
  const caseData = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      suspects: true,
      entities: { take: 200 },
      nodes: { take: 300 },
      edges: { take: 500 },
      evidence: { take: 100, orderBy: { uploadedAt: "desc" } },
      transactions: { take: 500, orderBy: { timestamp: "desc" } },
      callRecords: { take: 500, orderBy: { callTime: "desc" } },
      alerts: { where: { resolved: false }, take: 50 },
    },
  });

  if (!caseData) return {};

  const firTexts: string[] = [];
  if (caseData.description) firTexts.push(caseData.description);

  // Fallback check: check historical_cases.json if relational tables in DB are empty
  let suspects = caseData.suspects;
  let entities = caseData.entities;

  if (suspects.length === 0) {
    try {
      const histPath = path.join(__dirname, "..", "..", "data", "generated", "historical_cases.json");
      if (fs.existsSync(histPath)) {
        const histData = JSON.parse(fs.readFileSync(histPath, "utf-8"));
        const matched = histData.find(
          (h: any) => h.case_number === caseData.caseNumber || h.title === caseData.title
        );
        if (matched) {
          if (matched.fir_text && !firTexts.includes(matched.fir_text)) {
            firTexts.push(matched.fir_text);
          }
          if (matched.suspects) {
            suspects = matched.suspects.map((s: any) => ({
              id: s.name,
              name: s.name,
              aliases: s.aliases || [],
              role: s.role || "EXECUTOR",
              kingpinScore: s.kingpin_score || 0,
              phoneNumbers: s.phone_numbers || [],
            })) as any;
          }
        }
      }
    } catch (e) {
      logger.warn("Historical fallback read failed", e as Error);
    }
  }

  return {
    case_id: caseData.id,
    case_number: caseData.caseNumber,
    case_title: caseData.title,
    case_status: caseData.status,
    case_priority: caseData.priority,
    jurisdiction: caseData.jurisdiction,
    description: caseData.description || "",
    fir_texts: firTexts,
    entities: entities.map((e) => ({
      id: e.id,
      type: e.type,
      value: e.value,
      confidence: e.confidence,
      layer: e.layer,
    })),
    suspects: suspects.map((s) => ({
      id: s.id,
      name: s.name,
      aliases: s.aliases,
      role: s.role,
      kingpinScore: s.kingpinScore,
      phoneNumbers: s.phoneNumbers,
    })),
    nodes: caseData.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      role: n.role,
      kingpinScore: n.kingpinScore,
    })),
    edges: caseData.edges.map((e) => ({
      sourceId: e.sourceId,
      targetId: e.targetId,
      relationType: e.relationType,
      evidence: e.evidence,
    })),
    transactions: caseData.transactions.map((t) => ({
      fromAccount: t.fromAccount,
      toAccount: t.toAccount,
      amount: t.amount,
      timestamp: t.timestamp,
      transactionType: t.transactionType,
    })),
    call_records: caseData.callRecords.map((c) => ({
      fromNumber: c.fromNumber,
      toNumber: c.toNumber,
      durationSec: c.durationSec,
      callTime: c.callTime,
    })),
    evidence: caseData.evidence.map((e) => ({
      type: e.type,
      fileName: e.fileName,
      uploadedAt: e.uploadedAt,
    })),
    alerts: caseData.alerts.map((a) => ({
      type: a.type,
      severity: a.severity,
      message: a.message,
    })),
  };
}

async function buildGlobalCasesCatalog() {
  const allCases = await prisma.case.findMany({
    select: {
      id: true,
      caseNumber: true,
      title: true,
      status: true,
      priority: true,
      jurisdiction: true,
      description: true,
    },
    take: 20,
    orderBy: { createdAt: "desc" },
  });

  return allCases.map((c) => ({
    case_id: c.id,
    case_number: c.caseNumber,
    title: c.title,
    status: c.status,
    jurisdiction: c.jurisdiction,
    summary: c.description.slice(0, 150),
  }));
}

export async function chatQuery(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user as { id: string; role: string; name: string };
    if (!user) throw new ApiError(401, "Unauthenticated");

    const body = req.body as ChatQueryBody;
    if (!body?.question) throw new ApiError(400, "question is required");

    // 1. Resolve Case ID
    let resolvedCaseId = body.caseId || null;
    if (!resolvedCaseId) {
      resolvedCaseId = await autoDetectCase(body.question);
    }

    // 2. Build context bundle
    let context: any = {};
    if (resolvedCaseId) {
      context = await buildCaseContext(resolvedCaseId, user);
    }

    // 3. Fallback catalog
    if (!resolvedCaseId || !context.case_id) {
      const catalog = await buildGlobalCasesCatalog();
      context = {
        global_cases_catalog: catalog,
      };
    }

    // 4. Persist conversation
    let conversationId = body.conversationId || null;
    if (!conversationId) {
      const conv = await prisma.chatConversation.create({
        data: {
          userId: user.id,
          caseId: resolvedCaseId || null,
          title: body.question.slice(0, 80),
        },
      });
      conversationId = conv.id;
    }

    await prisma.chatMessage.create({
      data: {
        conversationId,
        role: "user",
        content: body.question,
      },
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write(
      `data: ${JSON.stringify({
        type: "conversation",
        data: { conversationId, resolvedCaseId },
      })}\n\n`
    );

    const aiUrl = `${env.aiServiceUrl}/api/chat/query`;
    const aiResp = await fetch(aiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: body.question,
        case_id: resolvedCaseId || null,
        history: body.history || [],
        context,
        user_role: user.role,
        user_name: user.name,
      }),
    });

    if (!aiResp.ok || !aiResp.body) {
      res.write(`data: ${JSON.stringify({ type: "error", data: { message: "AI service failed" } })}\n\n`);
      res.end();
      return;
    }

    let assistantBuffer = "";
    let detectedIntent = "";
    const reader = aiResp.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);

      const lines = chunk.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.type === "token" && parsed.data?.text) {
            assistantBuffer += parsed.data.text;
          }
          if (parsed.type === "intent" && parsed.data?.intent) {
            detectedIntent = parsed.data.intent;
          }
        } catch {}
      }
    }

    if (assistantBuffer.trim()) {
      await prisma.chatMessage.create({
        data: {
          conversationId,
          role: "assistant",
          content: assistantBuffer,
          intent: detectedIntent,
        },
      });
      await prisma.chatConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
    }

    res.end();
  } catch (err) {
    logger.error("chatQuery failed", err as Error);
    if (!res.headersSent) return next(err);
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        data: { message: (err as Error).message },
      })}\n\n`
    );
    res.end();
  }
}

export async function listConversations(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user as { id: string };
    const caseId = (req.query.caseId as string) || undefined;

    const conversations = await prisma.chatConversation.findMany({
      where: { userId: user.id, ...(caseId ? { caseId } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        _count: { select: { messages: true } },
      },
    });
    res.json({ conversations });
  } catch (err) {
    next(err);
  }
}

export async function getConversation(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user as { id: string };
    const conv = await prisma.chatConversation.findUnique({
      where: { id: req.params.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conv || conv.userId !== user.id) throw new ApiError(404, "Conversation not found");
    res.json({ conversation: conv });
  } catch (err) {
    next(err);
  }
}

export async function deleteConversation(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user as { id: string };
    const conv = await prisma.chatConversation.findUnique({ where: { id: req.params.id } });
    if (!conv || conv.userId !== user.id) throw new ApiError(404, "Conversation not found");
    await prisma.chatConversation.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}