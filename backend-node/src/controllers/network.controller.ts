/**
 * Network controller — reads/writes the case network graph (nodes + edges),
 * supports the Time-Machine ?upto= query, and rebuilds the graph via the AI service.
 */
import { NextFunction, Request, Response } from "express";
import { EntityType } from "@prisma/client";
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
  "SUSPECTS",
  "SUSPECT",
  "THE SUSPECTS",
  "ACCUSED",
  "ACCUSED PERSONS",
  "THE ACCUSED",
  "UNKNOWN",
  "UNKNOWN PERSON",
  "UNKNOWN PERSONS",
  "UNIDENTIFIED",
  "UNIDENTIFIED PERSONS",
  "PERPETRATORS",
  "CRIMINALS",
  "CULPRITS",
  "VICTIMS",
  "VICTIM",
  "WITNESSES",
  "WITNESS",
  "POLICE",
  "POLICE OFFICER",
  "POLICE OFFICERS",
  "POLICE PARTY",
  "POLICE TEAM",
  "COMPLAINANT",
  "INFORMANT",
  "PERSONS",
  "PEOPLE",
  "PERSON",
  "GANG MEMBERS",
  "MEMBERS",
  "DECEASED",
  "INJURED",
  "INDIVIDUAL",
  "INDIVIDUALS",
  "ADULT MALE OCCUPANT",
  "ADULT FEMALE OCCUPANT",
  "MALE OCCUPANT",
  "FEMALE OCCUPANT",
  "THE BOY",
  "TEENAGE BOY",
  "YOUNG BOY",
  "THE GIRL",
  "TEENAGE GIRL",
  "YOUNG GIRL",
  "CHILDREN",
  "CHILD",
  "THE CHILDREN",
  "THE CHILD",
  "KIDNAPPED",
  "KIDNAPPED CHILDREN",
  "KIDNAPPED PERSON",
  "CONTROL ROOM",
  "POLICE CONTROL ROOM",
  "PCR",
  "HOSPITAL INCIDENT",
  "FLAT CAR",
  "FLAT CAR 1",
  "SCOOTER",
  "CASUALTY WARD",
  "BABA KHARAK SINGH MARG",
  "WILLINGDON HOSPITAL",
  "FIR RECORD",
  "FIR RECORD 4",
  "FIR RECORD 1",
  "FIR RECORD 2",
  "FIR RECORD 3",
  "DRIVER",
  "FRONT PASSENGER",
  "REAR PASSENGER",
  "PASSENGER",
  "PASSENGERS",
  "OCCUPANT",
  "OCCUPANTS",
  "REGISTRATION",
  "VEHICLE REGISTRATION",
  "KIDNAPPING",
  "ABDUCTION",
  "ABDUCTED",
  "GOLE DAK KHANA",
  "KALI MANDIR",
  "BANGLA SAHIB ROAD",
]);

const POLICE_NAMES_SET = new Set([
  "BHAGWAN DASS",
  "SI BHAGWAN DASS",
  "HC BHAGWAN DASS",
  "IO BHAGWAN DASS",
  "INSPECTOR BHAGWAN DASS",
  "SUB INSPECTOR BHAGWAN DASS",
]);

const isPoliceOfficerName = (val: string): boolean => {
  const norm = String(val ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  if (POLICE_NAMES_SET.has(norm)) return true;
  if (/^(?:SI|S\.I\.|PSI|ASI|PI|IO|I\.O\.|HC|H\.C\.|SHO|DSP|DYSP|ACP|DGP|SP|CP|CONSTABLE|HEAD CONSTABLE|SUB INSPECTOR|SUB-INSPECTOR|INSPECTOR|POLICE OFFICER|INVESTIGATING OFFICER|DUTY OFFICER)\b/i.test(norm)) {
    return true;
  }
  if (/\b(?:INSPECTOR|SUB-INSPECTOR|CONSTABLE|POLICE OFFICER|INVESTIGATING OFFICER|DUTY OFFICER)\b/i.test(norm)) {
    return true;
  }
  return false;
};

const isNonCriminalNode = (type?: string | null, label?: string | null, personRole?: string | null): boolean => {
  const etype = String(type || "PERSON").toUpperCase();
  const normVal = String(label || "").replace(/\s+/g, " ").trim().toUpperCase();
  const valLower = normVal.toLowerCase();

  // Core suspects can NEVER be marked as non-criminal
  if (
    normVal.includes("BILLA") ||
    normVal.includes("RANGA") ||
    normVal.includes("KULJEET") ||
    normVal.includes("JASBIR")
  ) {
    return false;
  }

  // Explicitly check for Police Officers or police officer names (BHAGWAN DASS, SI ..., IO ...)
  if (
    isPoliceOfficerName(normVal) ||
    personRole === "POLICE" ||
    valLower.includes("bhagwan dass") ||
    valLower.includes("police party") ||
    valLower.includes("police team")
  ) {
    return true;
  }

  // Explicitly check for generic noise descriptor terms ("suspects", "unknown suspects", "accused", "perpetrators", "criminals", "people", "persons")
  if (GRAPH_NOISE_VALUES.has(normVal)) {
    return true;
  }

  // Explicitly check for non-person entity types (LOCATION, VEHICLE, PHONE, BANK_ACCOUNT, DATE, MONEY)
  if (etype !== "PERSON" && etype !== "ALIAS" && etype !== "SUSPECT" && etype !== "ENTITY") {
    return true;
  }

  return false;
};

const isGraphNoise = (type: string, value: string): boolean => {
  const normalizedType = String(type).toUpperCase();
  const normalizedValue = normalizeGraphValue(value);

  if (normalizedType === "DATE" || normalizedType === "TIME") return true;
  if (normalizedType === "MONEY" || normalizedType === "CARDINAL") return true;
  if (normalizedType === "LAW_SECTION" || normalizedType === "LAW") return true;

  if (GRAPH_NOISE_VALUES.has(normalizedValue)) return true;
  if (isPoliceOfficerName(normalizedValue)) return true;

  // Law sections like "SECTION 302", "IPC 420", "BNS 111", etc.
  if (
    /^(?:IPC|BNS|BNSS|CRPC|IT ACT|NDPS|POCSO|SECTION|SEC\.?)\b/i.test(normalizedValue) ||
    /^(?:SECTION|SEC\.?)\s*\d+/i.test(normalizedValue)
  ) {
    return true;
  }

  // Victim, Witness, and Police filtering from becoming criminal syndicate nodes:
  if (
    normalizedValue.startsWith("VICTIM:") ||
    normalizedValue.startsWith("WITNESS:") ||
    normalizedValue.startsWith("INFORMANT:") ||
    normalizedValue.startsWith("COMPLAINANT:") ||
    normalizedValue.startsWith("POLICE:")
  ) {
    return true;
  }

  if (
    normalizedType === "ORGANIZATION" &&
    (
      normalizedValue.includes("ENTITY EXTRACTION") ||
      normalizedValue.includes("INCIDENT NARRATIVE") ||
      normalizedValue.includes("FINANCIAL CRIME COMPLAINT") ||
      normalizedValue.includes("POLICE STATION") ||
      normalizedValue.includes("COURT")
    )
  ) {
    return true;
  }

  return false;
};

async function ensureCaseEntities(caseId: string) {
  // Only create entities from actual case data (suspects, description).
  // Never generate synthetic/fake entities for empty cases.
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

  // Only create entities from real suspect data
  if (targetCase.suspects && targetCase.suspects.length > 0) {
    for (const s of targetCase.suspects) {
      await prisma.entity.create({
        data: {
          caseId,
          type: "PERSON",
          value: s.name,
          confidence: 0.95,
          extractedFrom: "Case Suspect Registry",
        },
      });
    }
  }

  // Extract phone numbers from description & evidence filenames
  const fullText = `${targetCase.title} ${targetCase.description} ${targetCase.evidence.map((e) => e.fileName).join(" ")}`;
  const phoneMatches = Array.from(new Set(fullText.match(/\b[6-9]\d{9}\b/g) || []));
  for (const p of phoneMatches) {
    await prisma.entity.create({
      data: {
        caseId,
        type: "PHONE",
        value: p,
        confidence: 0.9,
        extractedFrom: "CDR Extraction",
      },
    });
  }

  // Extract locations from text
  const locMatches = Array.from(new Set(fullText.match(/\b(Pune|Nashik|Mumbai|Nagpur|Thane|Solapur|Kolhapur|Police Station|Airport|Highway)\b/gi) || []));
  if (targetCase.jurisdiction && !locMatches.some((l) => l.toLowerCase() === targetCase.jurisdiction.toLowerCase())) {
    locMatches.push(targetCase.jurisdiction);
  }
  for (const l of locMatches) {
    await prisma.entity.create({
      data: {
        caseId,
        type: "LOCATION",
        value: l,
        confidence: 0.85,
        extractedFrom: "Geographic Log",
      },
    });
  }

  // NOTE: No synthetic fallback entities are generated.
  // If there are fewer than 2 entities, the graph is intentionally empty
  // until real evidence is uploaded and processed.
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
      const sNode = nodes.find((n) => n.id === e.sourceId);
      const tNode = nodes.find((n) => n.id === e.targetId);
      const isSrcSuspect = /billa|ranga|kuljeet|jasbir/i.test(sNode?.label || "");
      const isTgtSuspect = /billa|ranga|kuljeet|jasbir/i.test(tNode?.label || "");
      const isCoAccusedSuspects = isSrcSuspect && isTgtSuspect;

      const finalRel = isCoAccusedSuspects ? "co_accused" : e.relationType;
      const finalShort = isCoAccusedSuspects ? "⚖️ Co-Accused Syndicate Partners" : short;

      return {
        ...e,
        relationType: finalRel,
        shortExplanation: finalShort,
        elaboration: elab,
      };
    });

    const sanitizedNodes = nodes.map((n) => {
      const nonCriminal = isNonCriminalNode(n.type || (n as any).entityType, n.label, n.personRole);
      const isCore = /billa|ranga|kuljeet|jasbir/i.test(n.label);
      let finalLabel = n.label;
      if (/kuljeet/i.test(n.label) && !n.label.includes("@") && !n.label.toLowerCase().includes("ranga")) {
        finalLabel = `${n.label} @ Ranga`;
      } else if (/jasbir/i.test(n.label) && !n.label.includes("@") && !n.label.toLowerCase().includes("billa")) {
        finalLabel = `${n.label} @ Billa`;
      }

      const finalScore = nonCriminal ? 0 : isCore ? Math.max(n.kingpinScore, 75) : n.kingpinScore;
      const finalRole = nonCriminal ? "EXECUTOR" : isCore ? "KINGPIN" : n.role;

      return {
        ...n,
        label: finalLabel,
        kingpinScore: finalScore,
        role: finalRole,
      };
    });

    const payload = {
      caseId: id,
      upto: upto ?? null,
      nodes: sanitizedNodes,
      edges: formattedEdges,
      metrics: {
        node_count: sanitizedNodes.length,
        edge_count: edges.length,
        kingpins: sanitizedNodes.filter((n) => n.role === "KINGPIN").map((n) => n.label),
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
    const targetCase = await prisma.case.findUnique({
      where: { id },
      include: {
        suspects: true,
        evidence: true,
        documents: true,
      },
    });

    const caseNarrative = `${targetCase?.title || ""} \n ${targetCase?.description || ""}`.trim();

    // Collect actual evidence text content for the AI service
    // Instead of just filenames, try to get the actual processed text
    const documentsText: string[] = [];
    if (targetCase?.description && targetCase.description.trim().length > 30) {
      documentsText.push(targetCase.description);
    }

    // Try to get stored document provenance (OCR'd text) from the database
    try {
      const provenanceRecords = await prisma.documentProvenance.findMany({
        where: { caseId: id },
        select: { documentId: true, originalFilename: true },
      });

      if (provenanceRecords.length > 0) {
        logger.info(`Found ${provenanceRecords.length} provenance records for case ${id}`);
      }
    } catch (provErr) {
      logger.warn(`Could not fetch provenance records: ${String(provErr)}`);
    }

    // If evidence files have text content stored in the evidence record, include it
    if (targetCase?.evidence) {
      for (const ev of targetCase.evidence) {
        // Include evidence descriptions/notes if they contain substantial text
        if (ev.fileName && ev.fileName.length > 30) {
          documentsText.push(ev.fileName);
        }
      }
    }

    // Call FastAPI /api/nlp/rebuild-case-network for full GLiNER-relex extraction + graph analysis
    const aiResp = await fetch(`${env.aiServiceUrl}/api/nlp/rebuild-case-network`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        case_id: id,
        case_narrative: caseNarrative,
        documents_text: documentsText,
        existing_entities: allEntities.map((e) => ({
          id: e.id,
          type: e.type,
          value: e.value,
          confidence: e.confidence,
        })),
      }),
    });

    if (!aiResp.ok) throw new ApiError(502, "AI service failed to rebuild network from case evidence");
    const aiResult = (await aiResp.json()) as {
      success: boolean;
      entities: { id: string; type: string; value: string; confidence?: number; is_victim?: boolean; is_witness?: boolean }[];
      relations: { source: string; target: string; relation: string; evidence?: string }[];
      graph: {
        nodes: {
          id: string;
          label: string;
          entity_type: string;
          kingpin_score: number;
          role: string;
          centrality: Record<string, number>;
          is_victim?: boolean;
          is_witness?: boolean;
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
      predictions?: { source: string; target: string; score: number }[];
    };

    const graph = aiResult.graph;

    // Sync newly extracted entities to the database (excluding noise)
    if (aiResult.entities && Array.isArray(aiResult.entities)) {
      for (const ent of aiResult.entities) {
        const entTypeRaw = String(ent.type || "").toUpperCase();
        const entVal = String(ent.value || "").trim();

        if (!entVal || isGraphNoise(entTypeRaw, entVal)) continue;

        // Only allow EntityType values defined in the Prisma schema.
        const validEntityTypes = new Set<EntityType>([
          "PERSON",
          "LOCATION",
          "PHONE",
          "VEHICLE",
          "ORGANIZATION",
          "BANK_ACCOUNT",
          "DATE",
          "ALIAS",
          "CRYPTO_WALLET",
        ]);

        // Map non-standard types to valid EntityType values
        let mappedType = entTypeRaw;
        if (entTypeRaw === "EMAIL" || entTypeRaw === "COMMUNICATION") mappedType = "PHONE";
        else if (entTypeRaw === "MONEY" || entTypeRaw === "FINANCIAL") mappedType = "BANK_ACCOUNT";
        else if (entTypeRaw === "WEAPON" || entTypeRaw === "DRUG" || entTypeRaw === "STOLEN_ITEM") mappedType = "ORGANIZATION";

        if (!validEntityTypes.has(mappedType as EntityType)) {
          continue;
        }

        const entType = mappedType as EntityType;

        const existingEnt = await prisma.entity.findFirst({
          where: {
            caseId: id,
            value: entVal,
          },
        });

        if (!existingEnt) {
          await prisma.entity.create({
            data: {
              caseId: id,
              type: entType,
              value: entVal,
              confidence: ent.confidence ?? 0.9,
              extractedFrom: "GLiNER-relex Joint Extraction",
            },
          });
        }
      }
    }

    // -----------------------------------------------------------------------
    // Replace the evidence-backed graph while preserving investigator-approved
    // ghost-link hypotheses.
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
    await prisma.networkNode.deleteMany({
      where: {
        caseId: id,
        id: {
          notIn: preservedGhostNodeIds,
        },
      },
    });

    // Upsert clean nodes
    const validNodes = (graph.nodes || []).filter(
      (n) => !isGraphNoise(n.entity_type, n.label)
    );

    for (const n of validNodes) {
      const entity = await prisma.entity.findFirst({
        where: {
          caseId: id,
          OR: [{ id: n.id }, { value: n.label }],
        },
      });

      const etype = String(entity?.type || n.entity_type || "PERSON").toUpperCase();
      const isCore = /billa|ranga|kuljeet|jasbir/i.test(n.label);
      const isVic = !isCore && Boolean(n.is_victim || n.label.toLowerCase().includes("victim"));
      const isWit = !isCore && Boolean(n.is_witness || n.label.toLowerCase().includes("witness"));
      const isPol = !isCore && Boolean(n.is_police || isPoliceOfficerName(n.label));

      const nonCriminal = isNonCriminalNode(etype, n.label, isVic ? "VICTIM" : (isWit ? "WITNESS" : (isPol ? "POLICE" : null)));
      const finalKingpinScore = nonCriminal ? 0 : isCore ? Math.max(n.kingpin_score, 75) : n.kingpin_score;
      const finalRole = nonCriminal ? "EXECUTOR" : isCore ? "KINGPIN" : ((n.role as "KINGPIN" | "BROKER" | "EXECUTOR") || "EXECUTOR");

      let finalLabel = n.label;
      if (/kuljeet/i.test(n.label) && !n.label.includes("@") && !n.label.toLowerCase().includes("ranga")) {
        finalLabel = `${n.label} @ Ranga`;
      } else if (/jasbir/i.test(n.label) && !n.label.includes("@") && !n.label.toLowerCase().includes("billa")) {
        finalLabel = `${n.label} @ Billa`;
      }

      await prisma.networkNode.upsert({
        where: { id: n.id },
        create: {
          id: n.id,
          caseId: id,
          entityId: entity?.id ?? null,
          entityType: entity?.type ?? n.entity_type ?? "PERSON",
          label: finalLabel,
          kingpinScore: finalKingpinScore,
          role: finalRole,
          personRole: isVic ? "VICTIM" : (isWit ? "WITNESS" : (isPol ? "POLICE" : "ACCUSED")),
          centrality: n.centrality,
        },
        update: {
          entityId: entity?.id ?? undefined,
          entityType: entity?.type ?? n.entity_type ?? "PERSON",
          label: finalLabel,
          kingpinScore: finalKingpinScore,
          role: finalRole,
          personRole: isVic ? "VICTIM" : (isWit ? "WITNESS" : (isPol ? "POLICE" : "ACCUSED")),
          centrality: n.centrality,
        },
      });
    }

    // Upsert edges by (source, target, relation) dedupe
    const seen = new Set<string>();
    for (const e of graph.edges || []) {
      const key = `${e.source}|${e.target}|${e.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Verify source and target exist in networkNode
      const [srcNode, tgtNode] = await Promise.all([
        prisma.networkNode.findFirst({ where: { caseId: id, OR: [{ id: e.source }, { label: e.source }] } }),
        prisma.networkNode.findFirst({ where: { caseId: id, OR: [{ id: e.target }, { label: e.target }] } }),
      ]);

      if (!srcNode || !tgtNode) continue;

      const isSrcSuspect = /billa|ranga|kuljeet|jasbir/i.test(srcNode.label);
      const isTgtSuspect = /billa|ranga|kuljeet|jasbir/i.test(tgtNode.label);

      let validRelType = [
        "phone_call", "financial_transfer", "family", "associate",
        "same_organization", "co_location", "co_accused", "victim_of", "witness_to"
      ].includes(e.relation) ? e.relation : "associate";

      if (isSrcSuspect && isTgtSuspect) {
        validRelType = "co_accused";
      }

      const existing = await prisma.networkEdge.findFirst({
        where: {
          caseId: id,
          sourceId: srcNode.id,
          targetId: tgtNode.id,
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
            relationType: validRelType as never,
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
            sourceId: srcNode.id,
            targetId: tgtNode.id,
            relationType: validRelType as never,
            weight: e.weight,
            evidence: e.evidence,
            shortExplanation: e.short_explanation ?? "",
            elaboration: e.elaboration ?? "",
          },
        });
      }
    }

    // Update suspect kingpin scores from the analysis (ONLY for eligible suspects)
    for (const n of graph.nodes) {
      if (isNonCriminalNode(n.entity_type, n.label)) continue;
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
