/**
 * Network controller — reads/writes the case network graph (nodes + edges),
 * supports the Time-Machine ?upto= query, and rebuilds the graph via the AI service.
 */
import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma";
import { ApiError } from "../middleware/errorHandler";
import { env } from "../config/env";
import { audit } from "../services/audit.service";
import { createAlert } from "../services/alert.service";
import { cache } from "../config/redis";
import { logger } from "../utils/logger";

/**
 * GET /api/cases/:id/network?upto=<ISO timestamp>
 * Time-Machine playback: filters nodes/edges by createdAt <= upto.
 */
export async function getNetwork(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const uptoRaw = req.query.upto as string | undefined;
    const upto = uptoRaw ? new Date(uptoRaw) : undefined;
    if (uptoRaw && upto && isNaN(upto.getTime())) throw new ApiError(400, "upto must be a valid ISO timestamp");

    const cacheKey = `network:${id}:${upto?.getTime() ?? "full"}`;
    const cached = await cache.get<unknown>(cacheKey);
    if (cached) return res.json(cached);

    const [nodes, edges] = await Promise.all([
      prisma.networkNode.findMany({
        where: { caseId: id, ...(upto ? { createdAt: { lte: upto } } : {}) },
        orderBy: { kingpinScore: "desc" },
      }),
      prisma.networkEdge.findMany({
        where: { caseId: id, ...(upto ? { createdAt: { lte: upto } } : {}) },
      }),
    ]);

    const payload = {
      caseId: id,
      upto: upto ?? null,
      nodes,
      edges,
      metrics: {
        node_count: nodes.length,
        edge_count: edges.length,
        kingpins: nodes.filter((n) => n.role === "KINGPIN").map((n) => n.label),
      },
    };
    await cache.set(cacheKey, payload, 60);
    res.json(payload);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/cases/:id/network/rebuild
 * Pulls the case's entities+relations and asks the AI service to recompute
 * kingpin scores, then upserts nodes/edges. Broadcasts network_updated.
 */
export async function rebuildNetwork(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const { id } = req.params;

    const entities = await prisma.entity.findMany({
      where: { caseId: id },
      select: { id: true, type: true, value: true, confidence: true, extractedFrom: true },
    });
    const relations: { source: string; target: string; relation: string; evidence: string }[] = [];
    const edges = await prisma.networkEdge.findMany({
      where: { caseId: id },
      include: { source: true, target: true },
    });
    for (const e of edges) {
      relations.push({
        source: e.source.label,
        target: e.target.label,
        relation: e.relationType,
        evidence: e.evidence,
      });
    }

    // Ask FastAPI for the graph analysis (Groq/NetworkX).
    const aiResp = await fetch(`${env.aiServiceUrl}/api/graph/build/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ case_id: id, entities, relations }),
    });
    if (!aiResp.ok) throw new ApiError(502, "AI service failed to rebuild graph");
    const graph = (await aiResp.json()) as {
      nodes: { id: string; label: string; entity_type: string; kingpin_score: number; role: string; centrality: Record<string, number> }[];
      edges: { source: string; target: string; relation: string; weight: number; evidence: string }[];
      metrics: Record<string, unknown>;
    };

    // Upsert nodes (map entity ids where possible)
    for (const n of graph.nodes) {
      const entity = await prisma.entity.findFirst({ where: { caseId: id, value: n.label } });
      await prisma.networkNode.upsert({
        where: { id: n.id },
        create: {
          id: n.id,
          caseId: id,
          entityId: entity?.id ?? null,
          label: n.label,
          kingpinScore: n.kingpin_score,
          role: (n.role as "KINGPIN" | "BROKER" | "EXECUTOR") || "EXECUTOR",
          centrality: n.centrality,
        },
        update: {
          kingpinScore: n.kingpin_score,
          role: (n.role as "KINGPIN" | "BROKER" | "EXECUTOR") || "EXECUTOR",
          centrality: n.centrality,
        },
      });
    }

    // Upsert edges by (source, target, relation) dedupe
    const seen = new Set<string>();
    for (const e of graph.edges) {
      const key = `${e.source}|${e.target}|${e.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = await prisma.networkEdge.findFirst({
        where: { caseId: id, sourceId: e.source, targetId: e.target },
      });
      if (existing) {
        await prisma.networkEdge.update({
          where: { id: existing.id },
          data: { relationType: e.relation as never, weight: e.weight, evidence: e.evidence },
        });
      } else {
        await prisma.networkEdge.create({
          data: {
            caseId: id,
            sourceId: e.source,
            targetId: e.target,
            relationType: e.relation as never,
            weight: e.weight,
            evidence: e.evidence,
          },
        });
      }
    }

    // Update suspect kingpin scores from the analysis
    for (const n of graph.nodes) {
      if (n.entity_type !== "PERSON") continue;
      await prisma.suspect.updateMany({
        where: { cases: { some: { id } }, name: n.label },
        data: { kingpinScore: n.kingpin_score, role: n.role as never },
      });
    }

    await audit({ userId: user.id, ipAddress: req.ip }, "NETWORK_REBUILT", "Case", id);
    await cache.del(`network:${id}:*`);

    const { cache: redisCache } = await import("../config/redis");
    await redisCache.publish("crimenetx:alerts", {
      event: "network_updated",
      caseId: id,
      metrics: graph.metrics,
    });

    res.json({ ok: true, metrics: graph.metrics, nodeCount: graph.nodes.length, edgeCount: graph.edges.length });
  } catch (err) {
    next(err);
  }
}

/** Accept/reject a ghost-link prediction (from the AI service). */
export async function reviewPrediction(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const { caseId } = req.params;
    const { source, target, accepted, score } = req.body as {
      source?: string;
      target?: string;
      accepted?: boolean;
      score?: number;
    };
    if (typeof accepted !== "boolean") throw new ApiError(400, "accepted boolean required");

    if (accepted) {
      // Create a low-weight suggested edge flagged as hypothesis.
      const src = await prisma.networkNode.findFirst({ where: { caseId, label: source } });
      const tgt = await prisma.networkNode.findFirst({ where: { caseId, label: target } });
      if (src && tgt) {
        await prisma.networkEdge.upsert({
          where: { id: `${src.id}_${tgt.id}_hypothesis` },
          create: {
            id: `${src.id}_${tgt.id}_hypothesis`,
            caseId,
            sourceId: src.id,
            targetId: tgt.id,
            relationType: "associate",
            weight: score ?? 0.5,
            evidence: "investigator-accepted ghost link prediction",
          },
          update: {},
        });
      }
    }

    await audit(
      { userId: user.id, ipAddress: req.ip },
      accepted ? "GHOST_LINK_ACCEPTED" : "GHOST_LINK_REJECTED",
      "NetworkEdge",
      caseId,
      { source, target, score }
    );
    res.json({ ok: true, accepted });
  } catch (err) {
    next(err);
  }
}
