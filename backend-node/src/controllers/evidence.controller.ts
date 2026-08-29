/**
 * Evidence controller — presigned S3 URLs, metadata + SHA-256 chain of custody.
 */
import { NextFunction, Request, Response } from "express";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { EvidenceType } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";
import { createPresignedUpload } from "../config/s3";
import { audit } from "../services/audit.service";
import { createAlert } from "../services/alert.service";
import { logger } from "../utils/logger";

const VALID_TYPES: EvidenceType[] = ["FIR", "CDR", "BANK", "PHOTO", "DOCUMENT", "CCTV"];

/** POST /api/evidence/upload-url — request a presigned upload URL. */
export async function getUploadUrl(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const { caseId, fileName, contentType, type } = req.body as {
      caseId?: string;
      fileName?: string;
      contentType?: string;
      type?: EvidenceType;
    };

    if (!caseId || !fileName || !contentType) {
      throw new ApiError(400, "caseId, fileName and contentType are required");
    }
    if (type && !VALID_TYPES.includes(type)) {
      throw new ApiError(400, `type must be one of: ${VALID_TYPES.join(", ")}`);
    }

    const presigned = await createPresignedUpload(caseId, fileName, contentType);
    await audit(
      { userId: user.id, ipAddress: req.ip },
      "EVIDENCE_UPLOAD_URL_REQUESTED",
      "Evidence",
      caseId,
      { fileName, type }
    );
    res.json({ ...presigned, contentType, type });
  } catch (err) {
    next(err);
  }
}

/** POST /api/evidence — register metadata + SHA-256 hash after upload. */
export async function registerEvidence(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const {
      caseId,
      type,
      fileName,
      s3Url,
      sha256Hash,
      gpsLat,
      gpsLng,
      capturedAt,
      fileSize,
    } = req.body as {
      caseId?: string;
      type?: EvidenceType;
      fileName?: string;
      s3Url?: string;
      sha256Hash?: string;
      gpsLat?: number;
      gpsLng?: number;
      capturedAt?: string;
      fileSize?: number;
    };

    if (!caseId || !type || !fileName) throw new ApiError(400, "caseId, type and fileName are required");
    if (!VALID_TYPES.includes(type)) throw new ApiError(400, "Invalid evidence type");
    if (sha256Hash && !/^[a-f0-9]{64}$/i.test(sha256Hash)) {
      throw new ApiError(400, "sha256Hash must be a 64-char hex string");
    }

    const record = await prisma.evidence.create({
      data: {
        caseId,
        type,
        fileName,
        s3Url: s3Url || "",
        sha256Hash: sha256Hash || "",
        uploadedBy: user.id,
        gpsLat: gpsLat ?? null,
        gpsLng: gpsLng ?? null,
        capturedAt: capturedAt ? new Date(capturedAt) : null,
      },
    });

    await audit(
      { userId: user.id, ipAddress: req.ip },
      "EVIDENCE_UPLOADED",
      "Evidence",
      record.id,
      { caseId, fileName, type, sha256Hash, fileSize }
    );

    // Real-time fan-out to dashboards.
    const { cache } = await import("../config/redis");
    await cache.publish("crimenetx:alerts", {
      event: "new_evidence_uploaded",
      evidence: {
        id: record.id,
        caseId,
        type,
        fileName,
        sha256Hash,
        uploadedBy: user.name,
        uploadedAt: record.uploadedAt,
      },
    });
    await createAlert({
      caseId,
      type: "EVIDENCE_UPLOAD",
      severity: "INFO",
      message: `New ${type} evidence uploaded: ${fileName}`,
      data: { evidenceId: record.id, hash: sha256Hash },
    });

    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

/** GET /api/cases/:id/evidence */
export async function listEvidence(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const data = await prisma.evidence.findMany({
      where: { caseId: id },
      orderBy: { uploadedAt: "desc" },
      include: { uploader: { select: { id: true, name: true, email: true } } },
    });
    res.json({ data, total: data.length });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Local demo upload fallback (when S3 keys are absent)
// ---------------------------------------------------------------------------
const LOCAL_DIR = path.join(process.cwd(), "uploads");

export async function localUpload(req: Request, res: Response, next: NextFunction) {
  try {
    const key = String(req.query.key || "");
    if (!key) throw new ApiError(400, "key required");
    if (!req.file) throw new ApiError(400, "file required (multipart field 'file')");

    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    const safe = key.replace(/^cases\//, "cases/").replace(/[^a-zA-Z0-9._/-]/g, "_");
    const dest = path.join(LOCAL_DIR, safe);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, req.file.buffer);

    const hash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    res.json({ uploadUrl: `/api/evidence/object/${encodeURIComponent(key)}`, sha256Hash: hash });
  } catch (err) {
    next(err);
  }
}

export async function getObject(req: Request, res: Response, next: NextFunction) {
  try {
    const key = decodeURIComponent(req.params.key || "");
    const safe = key.replace(/\.\./g, "");
    const filePath = path.join(LOCAL_DIR, safe);
    if (!filePath.startsWith(path.resolve(LOCAL_DIR))) throw new ApiError(400, "Invalid path");
    if (!fs.existsSync(filePath)) throw new ApiError(404, "Object not found");
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/evidence/:caseId/import-nlp
 *
 * Persists entities + relations returned by the AI NLP pipeline,
 * creates graph nodes/edges, then rebuilds the network so that
 * kingpin scores and graph metrics are calculated.
 */
export async function importNlpResults(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const { caseId } = req.params;

    const {
      source,
      entities = [],
      relations = [],
    } = req.body as {
      source?: string;
      entities?: Array<{
        id?: string;
        type: string;
        value: string;
        confidence?: number;
        layer?: string;
        attributes?: Record<string, unknown>;
      }>;
      relations?: Array<{
        source?: string;
        target?: string;
        sourceId?: string;
        targetId?: string;
        relation?: string;
        evidence?: string;
        weight?: number;
      }>;
    };

    if (!caseId) {
      throw new ApiError(400, "caseId is required");
    }

    if (!Array.isArray(entities)) {
      throw new ApiError(400, "entities must be an array");
    }

    if (!Array.isArray(relations)) {
      throw new ApiError(400, "relations must be an array");
    }

    const normalize = (value: unknown): string =>
      String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

        
    // -----------------------------------------------------------------------
    // NLP graph filtering + alias resolution
    // -----------------------------------------------------------------------

    const aliasToCanonical = new Map<string, string>();

    for (const item of entities) {
      if (String(item.type).toUpperCase() !== "ALIAS") continue;

      const alias = normalize(item.value);
      const canonical = normalize(
        (item.attributes as Record<string, unknown> | undefined)?.canonical_name
      );

      if (alias && canonical) {
        aliasToCanonical.set(alias, canonical);
      }
    }

    const graphNoiseValues = new Set([
      "FIR",
      "NLP",
      "INVESTIGATION NOTE",
      "NLP ENTITY EXTRACTION DEMONSTRATION",
      "CYBER / FINANCIAL CRIME COMPLAINT / INCIDENT NARRATIVE",
    ]);

    const isGraphNoise = (
      type: string,
      value: string
    ): boolean => {
      const normalizedType = String(type).toUpperCase();
      const normalizedValue = normalize(value);

      if (normalizedType === "ALIAS") return true;

      if (graphNoiseValues.has(normalizedValue)) {
        return true;
      }

      // Obvious document/header text.
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

      // Dates are kept in the Entity table for provenance,
      // but are not criminal-network nodes by default.
      if (normalizedType === "DATE") {
        return true;
      }

      return false;
    };

    const resolveAlias = (value: unknown): string => {
      const normalized = normalize(value);
      return aliasToCanonical.get(normalized) ?? normalized;
    };
    // -----------------------------------------------------------------------
    // 1. Persist entities and establish ONE canonical NetworkNode per Entity.
    // -----------------------------------------------------------------------

    const entityMap = new Map<string, string>();
    const nodeMap = new Map<string, string>();

    // Existing entities for this case, indexed by type + normalized value.
    const existingEntities = await prisma.entity.findMany({
      where: { caseId },
    });

    const entityByKey = new Map<string, typeof existingEntities[number]>();

    for (const entity of existingEntities) {
      entityByKey.set(
        `${String(entity.type).toUpperCase()}::${normalize(entity.value)}`,
        entity
      );
    }

    // Existing nodes for this case.
    const existingNodes = await prisma.networkNode.findMany({
      where: { caseId },
    });

    const nodeByEntityId = new Map<string, typeof existingNodes[number]>();
    const nodeByLabel = new Map<string, typeof existingNodes[number]>();

    for (const node of existingNodes) {
      if (node.entityId) {
        nodeByEntityId.set(node.entityId, node);
      }

      const labelKey = normalize(node.label);
      if (labelKey && !nodeByLabel.has(labelKey)) {
        nodeByLabel.set(labelKey, node);
      }
    }

    const validTypes = [
      "PERSON",
      "LOCATION",
      "PHONE",
      "VEHICLE",
      "ORGANIZATION",
      "BANK_ACCOUNT",
      "DATE",
      "ALIAS",
      "CRYPTO_WALLET",
    ];

    for (const item of entities) {
      if (!item.type || !item.value) continue;

      const value = String(item.value).trim();
      if (!value) continue;

      const type = String(item.type).toUpperCase();

            
      // ALIAS/DATE/document-header entities remain available for
      // provenance but must not become graph nodes.
      if (isGraphNoise(type, value)) {
        continue;
      }
      
      if (!validTypes.includes(type)) {
        logger.warn(`Skipping unsupported NLP entity type: ${type}`);
        continue;
      }

      const key = `${type}::${normalize(value)}`;

      let entity = entityByKey.get(key);

      if (!entity) {
        entity = await prisma.entity.create({
          data: {
            caseId,
            type: type as never,
            value,
            confidence: item.confidence ?? 0.8,
            extractedFrom: source ?? "NLP",
            layer: item.layer ?? "nlp",
          },
        });

        entityByKey.set(key, entity);
      }

      // Map both the normalized value and the exact entity ID.
      entityMap.set(normalize(value), entity.id);
      entityMap.set(entity.id, entity.id);

      // First preference: node already linked to this Entity.
      let node = nodeByEntityId.get(entity.id);

      // Second preference: an existing node with the same label.
      if (!node) {
        node = nodeByLabel.get(normalize(value));

        // If that node exists but belongs to an old/duplicate entity,
        // attach it to the canonical entity instead of creating another node.
        if (node && node.entityId !== entity.id) {
          node = await prisma.networkNode.update({
            where: { id: node.id },
            data: {
              entityId: entity.id,
              label: value,
            },
          });

          nodeByEntityId.set(entity.id, node);
        }
      }

      // Only create a node when no suitable canonical node exists.
      if (!node) {
        node = await prisma.networkNode.create({
          data: {
            id: entity.id,
            caseId,
            entityId: entity.id,
            label: value,
            kingpinScore: 0,
            role: "EXECUTOR",
            centrality: {},
          },
        });

        nodeByEntityId.set(entity.id, node);
        nodeByLabel.set(normalize(value), node);
      }

      nodeMap.set(normalize(value), node.id);
      nodeMap.set(entity.id, node.id);
    }

    // -----------------------------------------------------------------------
    // 2. Build additional lookup maps from ALL canonical entities/nodes.
    //    This allows relations returned by the AI to resolve even when the
    //    relation references an entity ID instead of its displayed value.
    // -----------------------------------------------------------------------

    const allCaseEntities = await prisma.entity.findMany({
      where: { caseId },
    });

    const allCaseNodes = await prisma.networkNode.findMany({
      where: { caseId },
    });

    const nodeIdByEntityId = new Map<string, string>();
    const nodeIdByLabel = new Map<string, string>();

    for (const node of allCaseNodes) {
      if (node.entityId) {
        nodeIdByEntityId.set(node.entityId, node.id);
      }

      const labelKey = normalize(node.label);
      if (labelKey && !nodeIdByLabel.has(labelKey)) {
        nodeIdByLabel.set(labelKey, node.id);
      }
    }

    for (const entity of allCaseEntities) {
      const nodeId = nodeIdByEntityId.get(entity.id);
      if (nodeId) {
        nodeMap.set(entity.id, nodeId);
        nodeMap.set(normalize(entity.value), nodeId);
        entityMap.set(entity.id, entity.id);
        entityMap.set(normalize(entity.value), entity.id);
      }
    }
        // -----------------------------------------------------------------------
    // 2.5 Ensure every relation endpoint exists as an Entity + NetworkNode.
    //
    // The AI may return a relation to an entity that was not independently
    // detected by the entity extractor. We must materialize those endpoints
    // instead of silently dropping the relation.
    // -----------------------------------------------------------------------

    const inferRelationEntityType = (
      value: string,
      relation?: string
    ): string => {
      const normalized = normalize(value);

      // Phone numbers
      if (/^\+?\d[\d\s-]{8,14}$/.test(value.trim())) {
        return "PHONE";
      }

      // Ethereum / EVM wallet addresses
      if (/^0x[a-fA-F0-9]{40}$/.test(value.trim())) {
        return "CRYPTO_WALLET";
      }

      // Relation semantics provide a useful fallback when the value itself
      // is not enough to determine the entity type.
      switch (String(relation ?? "").toLowerCase()) {
        case "phone_call":
          return "PHONE";
        case "financial_transfer":
          return "CRYPTO_WALLET";
        case "co_location":
          return "LOCATION";
        case "family":
        case "associate":
        case "same_organization":
          return "PERSON";
        default:
          break;
      }

      // Basic value-based location hints.
      if (
        /\b(in|near|at|road|circle|market|yard|station|nagar|city|district)\b/i.test(
          value
        )
      ) {
        return "LOCATION";
      }

      // Default relation endpoints to PERSON.
      return "PERSON";
    };

    const ensureRelationEndpoint = async (
      rawValue: unknown,
      relation?: string
    ): Promise<string | null> => {
      const rawText = String(rawValue ?? "").trim();
      if (!rawText) return null;

      const value = resolveAlias(rawText);
      const normalizedValue = normalize(value);

      const existingEntityId =
        entityMap.get(value) ??
        entityMap.get(normalizedValue);

      if (existingEntityId) {
        const existingNodeId =
          nodeMap.get(existingEntityId) ??
          nodeMap.get(normalizedValue) ??
          nodeIdByEntityId.get(existingEntityId) ??
          nodeIdByLabel.get(normalizedValue);

        if (existingNodeId) {
          return existingNodeId;
        }
      }

      // Reuse an existing Entity with the same value, regardless of type.
      // This prevents duplicate entities when an earlier extraction used a
      // different entity type for the same displayed value.
      let entity = allCaseEntities.find(
        (candidate) => normalize(candidate.value) === normalizedValue
      );

      if (!entity) {
        const inferredType = inferRelationEntityType(value, relation);

        entity = await prisma.entity.create({
          data: {
            caseId,
            type: inferredType as never,
            value,
            confidence: 0.8,
            extractedFrom: source ?? "NLP relation endpoint",
            layer: "nlp",
          },
        });

        allCaseEntities.push(entity);
      }

      entityMap.set(value, entity.id);
      entityMap.set(normalizedValue, entity.id);
      entityMap.set(entity.id, entity.id);

      // Reuse an existing canonical node if one exists.
            let node = nodeByEntityId.get(entity.id);

      if (!node) {
        const existingNodeId = nodeIdByEntityId.get(entity.id);

        if (existingNodeId) {
          node = allCaseNodes.find(
            (candidate) => candidate.id === existingNodeId
          );
        }
      }

      if (!node) {
        node = allCaseNodes.find(
          (candidate) => normalize(candidate.label) === normalizedValue
        );
      }

      if (!node) {
        node = allCaseNodes.find(
          (candidate) => normalize(candidate.label) === normalizedValue
        );
      }

      if (node) {
        if (node.entityId !== entity.id) {
          node = await prisma.networkNode.update({
            where: { id: node.id },
            data: {
              entityId: entity.id,
              label: value,
            },
          });
        }
      } else {
        node = await prisma.networkNode.create({
          data: {
            id: entity.id,
            caseId,
            entityId: entity.id,
            label: value,
            kingpinScore: 0,
            role: "EXECUTOR",
            centrality: {},
          },
        });
      }

      nodeMap.set(value, node.id);
      nodeMap.set(normalizedValue, node.id);
      nodeMap.set(entity.id, node.id);

      nodeIdByEntityId.set(entity.id, node.id);
      nodeIdByLabel.set(normalizedValue, node.id);

      return node.id;
    };

    // Materialize endpoints before processing relations.
    for (const relation of relations) {
      const relationName = String(
        relation.relation ?? "associate"
      ).trim().toLowerCase();

      await ensureRelationEndpoint(relation.sourceId ?? relation.source, relationName);
      await ensureRelationEndpoint(relation.targetId ?? relation.target, relationName);
    }

    // -----------------------------------------------------------------------
    // 3. Persist NLP relations as NetworkEdges.
    // -----------------------------------------------------------------------

    const relationMap: Record<string, string> = {
      phone_call: "phone_call",
      financial_transfer: "financial_transfer",
      family: "family",
      associate: "associate",
      same_organization: "same_organization",
      co_location: "co_location",
    };

    let createdEdges = 0;
    let skippedRelations = 0;

    for (const relation of relations) {
      const rawSource =
        relation.sourceId ??
        relation.source ??
        "";

      const rawTarget =
        relation.targetId ??
        relation.target ??
        "";

      const sourceRef = String(rawSource).trim();
      const targetRef = String(rawTarget).trim();

      if (!sourceRef || !targetRef) {
        skippedRelations++;
        logger.warn(
          `Skipping NLP relation with missing source/target: ${JSON.stringify(relation)}`
        );
        continue;
      }

      // Resolve by:
      // 1. node ID
      // 2. entity ID
      // 3. normalized entity/node label
      const sourceNodeId =
        nodeIdByEntityId.get(sourceRef) ??
        nodeMap.get(sourceRef) ??
        nodeIdByLabel.get(normalize(sourceRef));

      const targetNodeId =
        nodeIdByEntityId.get(targetRef) ??
        nodeMap.get(targetRef) ??
        nodeIdByLabel.get(normalize(targetRef));

      if (!sourceNodeId || !targetNodeId) {
        skippedRelations++;

        logger.warn(
          `Skipping NLP relation because node could not be resolved: ${sourceRef} -> ${targetRef}`
        );

        continue;
      }

      if (sourceNodeId === targetNodeId) {
        skippedRelations++;
        logger.warn(
          `Skipping self-relation: ${sourceRef} -> ${targetRef}`
        );
        continue;
      }

      const rawRelation = String(
        relation.relation ?? "associate"
      )
        .trim()
        .toLowerCase();

      const relationType =
        relationMap[rawRelation] ?? "associate";

      const weight =
        typeof relation.weight === "number" && relation.weight > 0
          ? relation.weight
          : 1;

      const existing = await prisma.networkEdge.findFirst({
        where: {
          caseId,
          sourceId: sourceNodeId,
          targetId: targetNodeId,
          relationType: relationType as never,
        },
      });

      if (existing) {
        continue;
      }

      await prisma.networkEdge.create({
        data: {
          caseId,
          sourceId: sourceNodeId,
          targetId: targetNodeId,
          relationType: relationType as never,
          weight,
          evidence:
            relation.evidence ||
            `NLP extracted relation from ${source ?? "source"}`,
        },
      });

      createdEdges++;
    }

    // -----------------------------------------------------------------------
    // 4. Load the COMPLETE canonical case graph and send it to Graph ML.
    // -----------------------------------------------------------------------

        // Only send meaningful network entities to Graph ML.
    // Historical/noisy Entity records remain in the database for
    // provenance but are excluded from the criminal network graph.

    const allEntitiesForGraph = await prisma.entity.findMany({
      where: { caseId },
      select: {
        id: true,
        type: true,
        value: true,
        confidence: true,
        extractedFrom: true,
        layer: true,
      },
    });

    const entitiesForGraph = allEntitiesForGraph.filter((entity) => {
  if (isGraphNoise(String(entity.type), entity.value)) {
    return false;
  }

  // If this value is known to be an alias, never create a separate
  // graph node for it — regardless of what entity type the extractor gave it.
  const normalizedValue = normalize(entity.value);

  if (aliasToCanonical.has(normalizedValue)) {
    return false;
  }

  return true;
});

    const existingEdges = await prisma.networkEdge.findMany({
      where: { caseId },
      include: {
        source: true,
        target: true,
      },
    });

    const graphRelations = existingEdges.map((edge) => ({
      source: edge.source.label,
      target: edge.target.label,
      relation: edge.relationType,
      evidence: edge.evidence,
      weight: edge.weight,
    }));

    const aiResp = await fetch(
      `${env.aiServiceUrl}/api/graph/build/${caseId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          case_id: caseId,
          entities: entitiesForGraph,
          relations: graphRelations,
        }),
      }
    );

    if (!aiResp.ok) {
      const errorText = await aiResp.text();

      logger.error(
        `Graph ML rebuild failed: ${aiResp.status} ${errorText}`
      );

      throw new ApiError(
        502,
        "AI service failed to rebuild graph"
      );
    }

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
    // 5. Apply Graph ML scores to canonical nodes only.
    // -----------------------------------------------------------------------

    for (const node of graph.nodes) {
      const entity = await prisma.entity.findFirst({
        where: {
          caseId,
          value: {
            equals: node.label,
            mode: "insensitive",
          },
        },
      });

      if (!entity) continue;

      let existingNode = await prisma.networkNode.findFirst({
        where: {
          caseId,
          entityId: entity.id,
        },
      });

      if (!existingNode) {
        existingNode = await prisma.networkNode.findFirst({
          where: {
            caseId,
            label: {
              equals: node.label,
              mode: "insensitive",
            },
          },
        });
      }

      if (existingNode) {
        await prisma.networkNode.update({
          where: {
            id: existingNode.id,
          },
          data: {
            entityId: entity.id,
            label: node.label,
            kingpinScore: node.kingpin_score,
            role:
              (node.role as "KINGPIN" | "BROKER" | "EXECUTOR") ||
              "EXECUTOR",
            centrality: node.centrality,
          },
        });
      } else {
        await prisma.networkNode.create({
          data: {
            id: entity.id,
            caseId,
            entityId: entity.id,
            label: node.label,
            kingpinScore: node.kingpin_score,
            role:
              (node.role as "KINGPIN" | "BROKER" | "EXECUTOR") ||
              "EXECUTOR",
            centrality: node.centrality,
          },
        });
      }

      if (node.entity_type === "PERSON") {
        await prisma.suspect.updateMany({
          where: {
            cases: {
              some: { id: caseId },
            },
            name: {
              equals: node.label,
              mode: "insensitive",
            },
          },
          data: {
            kingpinScore: node.kingpin_score,
            role: node.role as never,
          },
        });
      }
    }

    // -----------------------------------------------------------------------
    // 6. Audit + response.
    // -----------------------------------------------------------------------

    await audit(
      { userId: user.id, ipAddress: req.ip },
      "NLP_RESULTS_IMPORTED",
      "Case",
      caseId,
      {
        source,
        entityCount: entities.length,
        relationCount: relations.length,
        createdEdges,
        skippedRelations,
        graphNodeCount: graph.nodes.length,
        graphEdgeCount: graph.edges.length,
      }
    );

    res.json({
      ok: true,
      entityCount: entities.length,
      relationCount: relations.length,
      createdEdges,
      skippedRelations,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      metrics: graph.metrics,
    });
  } catch (err) {
    next(err);
  }
}
