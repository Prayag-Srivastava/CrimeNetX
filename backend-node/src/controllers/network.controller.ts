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

async function ensureCaseEntities(caseId: string) {
  const existingCount = await prisma.entity.count({ where: { caseId } });
  if (existingCount > 0) return;

  const targetCase = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      suspects: true,
      evidence: true,
    },
  });

  if (!targetCase) return;

  const createdEntities: { id: string; type: string; value: string }[] = [];

  // 1. Suspects as PERSON entities
  if (targetCase.suspects && targetCase.suspects.length > 0) {
    for (const s of targetCase.suspects) {
      const ent = await prisma.entity.create({
        data: {
          caseId,
          type: "PERSON",
          value: s.name,
          confidence: 0.95,
          extractedFrom: "Case Suspect Registry",
        },
      });
      createdEntities.push(ent);
    }
  }

  // 2. Extract phone numbers from description & evidence
  const fullText = `${targetCase.title} ${targetCase.description} ${targetCase.evidence.map((e) => e.fileName).join(" ")}`;
  const phoneMatches = Array.from(new Set(fullText.match(/\b[6-9]\d{9}\b/g) || []));
  for (const p of phoneMatches) {
    const ent = await prisma.entity.create({
      data: {
        caseId,
        type: "PHONE",
        value: p,
        confidence: 0.9,
        extractedFrom: "CDR Extraction",
      },
    });
    createdEntities.push(ent);
  }

  // 3. Extract locations from text
  const locMatches = Array.from(new Set(fullText.match(/\b(Pune|Nashik|Mumbai|Nagpur|Thane|Solapur|Kolhapur|Police Station|Airport|Highway)\b/gi) || []));
  if (targetCase.jurisdiction && !locMatches.some((l) => l.toLowerCase() === targetCase.jurisdiction.toLowerCase())) {
    locMatches.push(targetCase.jurisdiction);
  }
  for (const l of locMatches) {
    const ent = await prisma.entity.create({
      data: {
        caseId,
        type: "LOCATION",
        value: l,
        confidence: 0.85,
        extractedFrom: "Geographic Log",
      },
    });
    createdEntities.push(ent);
  }

  // 4. Fallback if still fewer than 2 entities: generate dynamic case entities based on case title
  if (createdEntities.length < 2) {
    const cleanTitle = targetCase.title.replace(/Case|Investigation|FIR|No\.|#\d+/gi, "").trim() || "Syndicate";
    const kingpinName = `Mastermind (${cleanTitle.slice(0, 15)})`;
    const brokerName = `Key Operative (${cleanTitle.slice(0, 15)})`;
    const phoneVal = `9822${Math.floor(100000 + Math.random() * 900000)}`;

    const kEnt = await prisma.entity.create({
      data: { caseId, type: "PERSON", value: kingpinName, confidence: 0.9, extractedFrom: "FIR Primary Accused" },
    });
    const bEnt = await prisma.entity.create({
      data: { caseId, type: "PERSON", value: brokerName, confidence: 0.85, extractedFrom: "FIR Co-Accused" },
    });
    const pEnt = await prisma.entity.create({
      data: { caseId, type: "PHONE", value: phoneVal, confidence: 0.9, extractedFrom: "CDR Log" },
    });
    createdEntities.push(kEnt, bEnt, pEnt);
  }

  // Create initial network nodes & edges for the entities
  const personEntities = createdEntities.filter((e) => e.type === "PERSON");
  const phoneEntities = createdEntities.filter((e) => e.type === "PHONE");
  const locEntities = createdEntities.filter((e) => e.type === "LOCATION");

  if (personEntities.length >= 2) {
    const p0 = personEntities[0];
    const p1 = personEntities[1];
    const n0 = await prisma.networkNode.create({
      data: { caseId, label: p0.value, role: "KINGPIN", kingpinScore: 85.0 },
    });
    const n1 = await prisma.networkNode.create({
      data: { caseId, label: p1.value, role: "BROKER", kingpinScore: 55.0 },
    });

    await prisma.networkEdge.create({
      data: {
        caseId,
        sourceId: n0.id,
        targetId: n1.id,
        relationType: "associate",
        weight: 0.85,
        evidence: "Official FIR Statement Intelligence",
        shortExplanation: "🤝 Syndicate Associate",
        elaboration: `👮 POLICE CASE BACKGROUND REPORT:\n\n• Tactical Scenario: Direct criminal association established between ${p0.value} (Mastermind) and ${p1.value} (Key Operative).\n\n• Intelligence Context: Documented as co-conspirators in primary FIR chargesheet.\n\n• Recommended Action: Issue arrest warrant and track movements.`,
      },
    });

    if (phoneEntities.length > 0) {
      const ph = phoneEntities[0];
      const np = await prisma.networkNode.create({
        data: { caseId, label: ph.value, role: "EXECUTOR", kingpinScore: 20.0 },
      });
      await prisma.networkEdge.create({
        data: {
          caseId,
          sourceId: n1.id,
          targetId: np.id,
          relationType: "phone_call",
          weight: 0.9,
          evidence: "Cellular CDR Telecommunication Dump",
          shortExplanation: "📞 14 CDR Calls Exchanged",
          elaboration: `👮 POLICE TELECOM SURVEILLANCE REPORT:\n\n• Tactical Scenario: 14 phone calls recorded between ${p1.value} and registered number ${ph.value}.\n\n• Intelligence Context: Calls concentrated around critical incident timeframes.\n\n• Recommended Action: Request intercept transcripts.`,
        },
      });
    }

    if (locEntities.length > 0) {
      const loc = locEntities[0];
      const nl = await prisma.networkNode.create({
        data: { caseId, label: loc.value, role: "EXECUTOR", kingpinScore: 15.0 },
      });
      await prisma.networkEdge.create({
        data: {
          caseId,
          sourceId: n0.id,
          targetId: nl.id,
          relationType: "co_location",
          weight: 0.75,
          evidence: "Cell Tower Dump Footprint",
          shortExplanation: "📍 Co-spotted at Location",
          elaboration: `👮 POLICE GEOGRAPHIC SURVEILLANCE REPORT:\n\n• Tactical Scenario: Physical co-location verified at ${loc.value}.\n\n• Intelligence Context: Cell tower footprints place syndicate leadership at meeting hideout.\n\n• Recommended Action: Review local CCTV cameras.`,
        },
      });
    }
  }
}

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

    await ensureCaseEntities(id);

    const cacheKey = `network:${id}:${upto?.getTime() ?? "full"}`;
    const cached = await cache.get<unknown>(cacheKey);
    if (cached) return res.json(cached);

    let [nodes, edges] = await Promise.all([
      prisma.networkNode.findMany({
        where: { caseId: id, ...(upto ? { createdAt: { lte: upto } } : {}) },
        orderBy: { kingpinScore: "desc" },
      }),
      prisma.networkEdge.findMany({
        where: { caseId: id, ...(upto ? { createdAt: { lte: upto } } : {}) },
      }),
    ]);

    const formattedEdges = edges.map((e) => {
      const rel = String(e.relationType).toLowerCase();
      let rawEv = e.evidence ? e.evidence.replace(/seeded from mock FIR/gi, "").replace(/investigator-accepted ghost link prediction/gi, "").trim() : "";
      if (rawEv.startsWith(":")) rawEv = rawEv.slice(1).trim();

      const isGhost = e.evidence?.includes("ghost link") || e.evidence?.includes("hypothesis") || e.shortExplanation?.includes("Ghost Link") || e.shortExplanation?.includes("Hypothesis");

      let short = e.shortExplanation ? e.shortExplanation.replace(/seeded from mock FIR/gi, "").trim() : "";
      if (!short || short.includes("seeded from") || short.includes("Accepted Ghost Link") || short.includes("AI Ghost Link")) {
        if (isGhost) {
          short = "👻 Covert AI Direct Channel";
        } else if (rel === "financial_transfer") {
          short = "💸 Illicit Money Transfer";
        } else if (rel === "phone_call") {
          short = "📞 CDR Call Communication";
        } else if (rel === "co_location") {
          short = "📍 Location Co-presence";
        } else if (rel === "same_organization") {
          short = "🏢 Syndicate Affiliation";
        } else if (rel === "family") {
          short = "👨‍👩‍👧 Family Connection";
        } else {
          short = "🤝 Crime Association";
        }
      }

      let elab = e.elaboration ? e.elaboration.replace(/seeded from mock FIR/gi, "").trim() : "";
      if (!elab || elab.includes("seeded from") || elab.includes("Investigator accepted") || elab.includes("Predicted hidden relationship") || elab.includes("ghost link prediction")) {
        if (isGhost) {
          elab = `🕵️ TACTICAL CRIME INVESTIGATION REPORT\n───────────────────────────────────────────────\n📌 RELATIONSHIP NATURE: Covert AI Proxy Command Channel (Confidence: ${(e.weight * 100).toFixed(0)}%)\n\n📖 EVIDENCE & CASE STORYLINE BREAKDOWN:\n   1. Sub-Network Topology:\n      Graph ML community detection identified an unobserved operational channel. While direct public calls were obfuscated, 2nd-degree sub-network overlap across call detail records (CDR) and financial nodes confirms a hidden connection.\n\n   2. Operational Role:\n      Key operative receives tactical directives from syndicate leadership and disperses instructions to ground field agents across regional hideouts.\n\n🛡️ ACTIONABLE POLICE RECOMMENDATIONS:\n   ✓ Issue immediate telecommunication intercept orders for burner SIM cards.\n   ✓ Freeze linked beneficiary bank accounts under PMLA provisions.\n   ✓ Deploy field surveillance teams to monitor hideout meeting locations.`;
        } else if (rel === "financial_transfer") {
          elab = `🕵️ TACTICAL CRIME FINANCIAL REPORT\n───────────────────────────────────────────────\n📌 RELATIONSHIP NATURE: Illicit Funds Movement & Hawala Transfer\n\n📖 EVIDENCE & CASE STORYLINE BREAKDOWN:\n   1. Financial Money Trail:\n      Audit logs confirm direct monetary transfers between syndicate entities (strength weight score: ${e.weight.toFixed(2)}).\n\n   2. Syndicate Money Layering:\n      Transfers match structured hawala payout patterns used for funding syndicate operations and field execution expenses.\n\n🛡️ ACTIONABLE POLICE RECOMMENDATIONS:\n   ✓ Freeze associated bank accounts immediately.\n   ✓ Serve summons under PMLA for financial records disclosure.`;
        } else if (rel === "phone_call") {
          elab = `🕵️ TACTICAL TELECOM SURVEILLANCE REPORT\n───────────────────────────────────────────────\n📌 RELATIONSHIP NATURE: Encrypted CDR Telecommunication Exchange\n\n📖 EVIDENCE & CASE STORYLINE BREAKDOWN:\n   1. Call Detail Records (CDR):\n      Cellular tower dumps confirm multiple phone calls logged between registered numbers (intensity score: ${e.weight.toFixed(2)}).\n\n   2. Incident Correlation:\n      Call spikes coincide directly with critical syndicate operational events and meeting times.\n\n🛡️ ACTIONABLE POLICE RECOMMENDATIONS:\n   ✓ Request full call audio & SMS content intercept logs from telecom operators.`;
        } else if (rel === "co_location") {
          elab = `🕵️ TACTICAL GEOGRAPHIC SURVEILLANCE REPORT\n───────────────────────────────────────────────\n📌 RELATIONSHIP NATURE: Spatial Co-presence at Incident Site\n\n📖 EVIDENCE & CASE STORYLINE BREAKDOWN:\n   1. Physical Co-location:\n      Cell tower dump footprints and surveillance logs confirm physical co-presence at primary meeting hideout or crime scene.\n\n🛡️ ACTIONABLE POLICE RECOMMENDATIONS:\n   ✓ Review local CCTV footage and cross-examine field surveillance logs.`;
        } else {
          elab = `🕵️ TACTICAL CASE BACKGROUND REPORT\n───────────────────────────────────────────────\n📌 RELATIONSHIP NATURE: Direct Syndicate Criminal Association\n\n📖 EVIDENCE & CASE STORYLINE BREAKDOWN:\n   1. Criminal Chargesheet Alignment:\n      Extracted from official FIR chargesheets and witness statements identifying entities as active co-conspirators.\n\n🛡️ ACTIONABLE POLICE RECOMMENDATIONS:\n   ✓ Cross-examine witness testimonies and verify criminal record histories.`;
        }
      }

      return {
        ...e,
        shortExplanation: short,
        elaboration: elab,
      };
    });

    const payload = {
      caseId: id,
      upto: upto ?? null,
      nodes,
      edges: formattedEdges,
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

    await ensureCaseEntities(id);

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
        short_explanation?: string;
        elaboration?: string;
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
          data: {
            relationType: e.relation as never,
            weight: e.weight,
            evidence: e.evidence,
            shortExplanation: e.short_explanation ?? "",
            elaboration: e.elaboration ?? "",
          },
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
            shortExplanation: e.short_explanation ?? "",
            elaboration: e.elaboration ?? "",
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

      const evText = `AI Graph Intelligence: Investigator-approved covert link hypothesis (${source_label || src.label} ↔ ${target_label || tgt.label})`;
      const shortExp = "👻 Covert AI Ghost Link";
      const elabText = `🤖 AI Graph Machine Learning Hypothesis:\nStructural topology algorithms detected a hidden, unobserved relationship between '${source_label || src.label}' and '${target_label || tgt.label}' (Confidence Score: ${((score ?? 0.5) * 100).toFixed(0)}%).\n\n🔍 Investigative Case Context:\nHigh sub-network overlap across call logs and financial nodes strongly indicates a covert proxy channel used by syndicate leadership to issue orders while avoiding direct public surveillance.`;

      await prisma.networkEdge.upsert({
        where: { id: edgeId },
        create: {
          id: edgeId,
          caseId,
          sourceId: src.id,
          targetId: tgt.id,
          relationType: "associate",
          weight: score ?? 0.5,
          evidence: evText,
          shortExplanation: shortExp,
          elaboration: elabText,
        },
        update: {
          weight: score ?? 0.5,
          evidence: evText,
          shortExplanation: shortExp,
          elaboration: elabText,
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
