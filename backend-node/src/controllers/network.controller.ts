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

const normalizeGraphValue = (value: unknown): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const GRAPH_NOISE_VALUES = new Set([
  "FIR",
  "NLP",
  "INVESTIGATION NOTE",
  "NLP ENTITY EXTRACTION DEMONSTRATION",
  "CYBER / FINANCIAL CRIME COMPLAINT / INCIDENT NARRATIVE",
]);

const isGraphNoise = (type: string, value: string): boolean => {
  const normalizedType = String(type).toUpperCase();
  const normalizedValue = normalizeGraphValue(value);

  if (normalizedType === "ALIAS") return true;

  if (GRAPH_NOISE_VALUES.has(normalizedValue)) return true;

  if (
    normalizedType === "ORGANIZATION" &&
    (
      normalizedValue.includes("ENTITY EXTRACTION") ||
      normalizedValue.includes("INCIDENT NARRATIVE") ||
      normalizedValue.includes("FINANCIAL CRIME COMPLAINT")
    )
  ) {
    return true;
  }

  // Dates remain available in Entity for provenance,
  // but are not network nodes.
  if (normalizedType === "DATE") return true;

  return false;
};

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

    const allEntities = await prisma.entity.findMany({
      where: { caseId: id },
      select: {
        id: true,
        type: true,
        value: true,
        confidence: true,
        extractedFrom: true,
        layer: true,
      },
    });

    const filteredEntities = allEntities.filter(
      (entity) => !isGraphNoise(String(entity.type), entity.value)
    );

    // Deduplicate graph entities by type + normalized value.
    // Keep the first database Entity record so the graph has one node
    // for one real-world entity.
    const seenEntityKeys = new Set<string>();

    const entities = filteredEntities.filter((entity) => {
      const key = `${String(entity.type).toUpperCase()}::${normalizeGraphValue(entity.value)}`;

      if (seenEntityKeys.has(key)) {
        return false;
      }

      seenEntityKeys.add(key);
      return true;
    });
    const relations: { source: string; target: string; relation: string; evidence: string }[] = [];
    const edges = await prisma.networkEdge.findMany({
      where: {
        caseId: id,
        NOT: {
          evidence: {
            contains: "investigator-accepted ghost link prediction",
          },
        },
      },
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
      nodes: {
        id: string;
        label: string;
        entity_type: string;
        kingpin_score: number;
        role: string;
        centrality: Record<string, number>;
      }[];
      edges: {
        source: string;
        target: string;
        relation: string;
        weight: number;
        evidence: string;
      }[];
      metrics: Record<string, unknown>;
    };

    // -----------------------------------------------------------------------
    // Replace the evidence-backed graph while preserving investigator-approved
    // ghost-link hypotheses.
    //
    // Rebuild must be idempotent: stale evidence-backed nodes/edges are removed
    // and recreated from the current Graph ML result.
    //
    // Accepted ghost links are hypotheses and must survive rebuilds.
    // Their endpoint nodes must therefore also be preserved.
    // -----------------------------------------------------------------------

    const acceptedGhostEdges = await prisma.networkEdge.findMany({
      where: {
        caseId: id,
        evidence: {
          contains: "investigator-accepted ghost link prediction",
        },
      },
      select: {
        sourceId: true,
        targetId: true,
      },
    });

    const preservedGhostNodeIds = Array.from(
      new Set(
        acceptedGhostEdges.flatMap((edge) => [
          edge.sourceId,
          edge.targetId,
        ])
      )
    );

    // Delete only evidence-backed edges.
    // Investigator-approved ghost-link edges survive.
    await prisma.networkEdge.deleteMany({
      where: {
        caseId: id,
        NOT: {
          evidence: {
            contains: "investigator-accepted ghost link prediction",
          },
        },
      },
    });

    // Delete stale evidence-backed nodes.
    // Nodes used by accepted ghost links are preserved.
    await prisma.networkNode.deleteMany({
      where: {
        caseId: id,
        id: {
          notIn: preservedGhostNodeIds,
        },
      },
    });


    // Upsert nodes using the Entity ID carried by the AI graph.
    for (const n of graph.nodes) {
      const entity = await prisma.entity.findFirst({
        where: {
          caseId: id,
          OR: [
            { id: n.id },
            { value: n.label },
          ],
        },
      });

      await prisma.networkNode.upsert({
        where: { id: n.id },
        create: {
        id: n.id,
        caseId: id,
        entityId: entity?.id ?? null,
        entityType: entity?.type ?? "UNKNOWN",
        label: n.label,
        kingpinScore: n.kingpin_score,
        role: (n.role as "KINGPIN" | "BROKER" | "EXECUTOR") || "EXECUTOR",
        centrality: n.centrality,
    },
        update: {
          entityId: entity?.id ?? undefined,
          entityType: entity?.type ?? "UNKNOWN",
          label: n.label,
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
        where: {
          caseId: id,
          sourceId: e.source,
          targetId: e.target,
          NOT: {
            evidence: {
              contains: "investigator-accepted ghost link prediction",
            },
          },
        },
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
    await cache.del(`network:${id}:full`);

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

    const {
      source,
      target,
      source_label,
      target_label,
      accepted,
      score,
    } = req.body as {
      source?: string;
      target?: string;
      source_label?: string;
      target_label?: string;
      accepted?: boolean;
      score?: number;
    };

    if (typeof accepted !== "boolean") {
      throw new ApiError(400, "accepted boolean required");
    }

    if (!source || !target) {
      throw new ApiError(400, "source and target node IDs are required");
    }

    if (accepted) {
      // IMPORTANT:
      // Ghost-link predictions use canonical NetworkNode IDs.
      // Never resolve them by label because labels are not unique.
      const [src, tgt] = await Promise.all([
        prisma.networkNode.findFirst({
          where: {
            id: source,
            caseId,
          },
        }),
        prisma.networkNode.findFirst({
          where: {
            id: target,
            caseId,
          },
        }),
      ]);

      if (!src || !tgt) {
        throw new ApiError(
          404,
          `Cannot accept ghost link: source or target node not found`
        );
      }

      const edgeId = `${src.id}_${tgt.id}_hypothesis`;

      await prisma.networkEdge.upsert({
        where: { id: edgeId },
        create: {
          id: edgeId,
          caseId,
          sourceId: src.id,
          targetId: tgt.id,
          relationType: "associate",
          weight: score ?? 0.5,
          evidence: `Investigator-accepted ghost link prediction${
            source_label && target_label
              ? `: ${source_label} ↔ ${target_label}`
              : ""
          }`,
        },
        update: {
          weight: score ?? 0.5,
          evidence: `Investigator-accepted ghost link prediction${
            source_label && target_label
              ? `: ${source_label} ↔ ${target_label}`
              : ""
          }`,
        },
      });

      // Invalidate the cached full network immediately so the newly
      // accepted relationship appears on the next GET.
      await cache.del(`network:${caseId}:full`);
    }

    await audit(
      { userId: user.id, ipAddress: req.ip },
      accepted ? "GHOST_LINK_ACCEPTED" : "GHOST_LINK_REJECTED",
      "NetworkEdge",
      caseId,
      {
        source,
        target,
        source_label,
        target_label,
        score,
      }
    );

    res.json({ ok: true, accepted });
  } catch (err) {
    next(err);
  }
}
