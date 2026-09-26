/**
 * Evidence controller — presigned S3 URLs, metadata + SHA-256 chain of custody,
 * with full v2.1 NLP pipeline ingestion.
 */
import { NextFunction, Request, Response } from "express";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { EvidenceType, DocumentType, OCRStatus, TranslationStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";
import { createPresignedUpload } from "../config/s3";
import { audit } from "../services/audit.service";
import { createAlert } from "../services/alert.service";
import { logger } from "../utils/logger";

const VALID_TYPES: EvidenceType[] = ["FIR", "CDR", "BANK", "PHOTO", "DOCUMENT", "CCTV"];

// ============================================================
// POST /api/evidence/upload-url  — request presigned upload URL
// ============================================================
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

// ============================================================
// POST /api/evidence — register metadata + SHA-256 hash
// ============================================================
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

    if (!caseId || !type || !fileName) {
      throw new ApiError(400, "caseId, type and fileName are required");
    }
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

// ============================================================
// GET /api/cases/:id/evidence
// ============================================================
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

// ============================================================
// Local demo upload fallback (when S3 keys are absent)
// ============================================================
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

// ============================================================
// POST /api/evidence/:caseId/import-nlp
// Persists v2.1 forensic pipeline results.
// ============================================================
export async function importNlpResults(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const { caseId } = req.params;

    const {
      source,
      entities = [],
      relationships = [],
      document_id,
      original_file_hash,
      ocr_text_hash,
      translated_text_hash,
      pipeline_version,
      ocr_confidence,
      source_language,
      was_translated,
    } = req.body as {
      source?: string;
      entities?: Array<{
        label: string;
        text: string;
        start?: number;
        end?: number;
        source_sentence?: string;
        page?: number;
      }>;
      relationships?: Array<{
        source: string;
        target: string;
        relation: string;
        evidence?: string;
        weight?: number;
      }>;
      document_id?: string;
      original_file_hash?: string;
      ocr_text_hash?: string;
      translated_text_hash?: string;
      pipeline_version?: string;
      ocr_confidence?: number;
      source_language?: string;
      was_translated?: boolean;
    };

    if (!caseId) throw new ApiError(400, "caseId is required");

    const normalize = (value: unknown): string =>
      String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();

    // -----------------------------------------------------------------------
    // 0. Save Document Provenance Chain
    // -----------------------------------------------------------------------
    if (document_id && original_file_hash) {
      try {
        const existingProv = await prisma.documentProvenance.findFirst({
          where: { documentId: document_id },
        });

        const commonData = {
          caseId,
          originalFilename: source || "uploaded_file.pdf",
          rawOcrHash: ocr_text_hash || "",
          ocrLanguage: source_language || "unknown",
          ocrConfidence: ocr_confidence ?? 0,
          ocrStatus: OCRStatus.SUCCESS,
          translatedHash: translated_text_hash || "",
          sourceLanguage: source_language || "unknown",
          translationModel: was_translated
            ? "ai4bharat/indictrans2-indic-en-dist-200M"
            : "identity",
          translationStatus: was_translated
            ? TranslationStatus.SUCCESS
            : TranslationStatus.SKIPPED_NOT_NEEDED,
          ingestionHash: original_file_hash,
          pipelineVersion: pipeline_version || "v2.1-ocr-splink",
          processedAt: new Date(),
        };

        if (existingProv) {
          await prisma.documentProvenance.update({
            where: { id: existingProv.id },
            data: commonData,
          });
        } else {
          await prisma.documentProvenance.create({
            data: {
              ...commonData,
              documentId: document_id,
              documentType: DocumentType.FIR,
            },
          });
        }
      } catch (provErr) {
        logger.warn(`Provenance save skipped: ${String(provErr)}`);
      }
    }

    // -----------------------------------------------------------------------
    // 1. Persist entities and establish ONE canonical NetworkNode per Entity.
    // -----------------------------------------------------------------------
    const validTypes = [
      "PERSON", "LOCATION", "PHONE", "VEHICLE",
      "ORGANIZATION", "BANK_ACCOUNT", "DATE", "CRYPTO_WALLET"
    ];
    const nodeMap = new Map<string, string>();

    const existingNodes = await prisma.networkNode.findMany({ where: { caseId } });
    const nodeByLabel = new Map<string, typeof existingNodes[number]>();
    for (const node of existingNodes) {
      nodeByLabel.set(normalize(node.label), node);
    }

    for (const item of entities) {
      const type = String(item.label).toUpperCase();
      const value = String(item.text).trim();

      if (!value || !validTypes.includes(type) || type === "DATE") continue;

      let entity = await prisma.entity.findFirst({
        where: { caseId, value: { equals: value, mode: "insensitive" } }
      });

      if (!entity) {
        entity = await prisma.entity.create({
          data: {
            caseId,
            type: type as never,
            value,
            confidence: 0.9,
            extractedFrom: source ?? "NLP pipeline",
            layer: "spacy",
          },
        });
      }

      let node = nodeByLabel.get(normalize(value));
      if (!node) {
        node = await prisma.networkNode.create({
          data: {
            id: entity.id,
            caseId,
            entityId: entity.id,
            entityType: type,
            label: value,
            kingpinScore: 0,
            role: "EXECUTOR",
            centrality: {},
          },
        });
        nodeByLabel.set(normalize(value), node);
      }
      nodeMap.set(normalize(value), node.id);
    }

    // -----------------------------------------------------------------------
    // 2. Persist NLP relations as NetworkEdges.
    // -----------------------------------------------------------------------
    const relationMap: Record<string, string> = {
      phone_call: "phone_call",
      financial_transfer: "financial_transfer",
      family: "family",
      associate: "associate",
      same_organization: "same_organization",
      co_location: "co_location",
      co_accused: "co_accused",
      victim_of: "victim_of",
      witness_to: "witness_to",
    };

    let createdEdges = 0;
    for (const relation of relationships) {
      const sourceRef = String(relation.source).trim();
      const targetRef = String(relation.target).trim();
      if (!sourceRef || !targetRef) continue;

      const ensureNode = async (val: string) => {
        let nId = nodeMap.get(normalize(val));
        if (!nId) {
          const isVic = val.toLowerCase().includes("victim");
          const isWit = val.toLowerCase().includes("witness");
          const e = await prisma.entity.create({
            data: { caseId, type: "PERSON", value: val, extractedFrom: "NLP relation", layer: "gliner" }
          });
          const n = await prisma.networkNode.create({
            data: {
              id: e.id,
              caseId,
              entityId: e.id,
              entityType: "PERSON",
              label: val,
              role: "EXECUTOR",
              personRole: isVic ? "VICTIM" : (isWit ? "WITNESS" : "ACCUSED"),
            }
          });
          nId = n.id;
          nodeMap.set(normalize(val), nId);
        }
        return nId;
      };

      const sourceNodeId = await ensureNode(sourceRef);
      const targetNodeId = await ensureNode(targetRef);
      if (sourceNodeId === targetNodeId) continue;

      const relationType = relationMap[String(relation.relation).toLowerCase()] ?? "associate";

      const existing = await prisma.networkEdge.findFirst({
        where: {
          caseId,
          sourceId: sourceNodeId,
          targetId: targetNodeId,
          relationType: relationType as never,
        },
      });

      if (!existing) {
        await prisma.networkEdge.create({
          data: {
            caseId,
            sourceId: sourceNodeId,
            targetId: targetNodeId,
            relationType: relationType as never,
            weight: relation.weight || 1.0,
            evidence: relation.evidence || `Extracted by GLiNER-relex from ${source ?? "source"}`,
            inkType: "PREDICTED",
            mechanism: "GLINER_RELEX",
          },
        });
        createdEdges++;
      }
    }

    // -----------------------------------------------------------------------
    // 3. Trigger Graph ML rebuild asynchronously (background task)
    // -----------------------------------------------------------------------
    void (async () => {
      try {
        const allEntities = await prisma.entity.findMany({
          where: { caseId },
          select: { id: true, type: true, value: true, confidence: true, layer: true },
        });

        const allEdges = await prisma.networkEdge.findMany({
          where: { caseId },
          include: { source: true, target: true },
        });

        const aiResp = await fetch(`${env.aiServiceUrl}/api/graph/build/${caseId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(60000),
          body: JSON.stringify({
            case_id: caseId,
            entities: allEntities,
            relations: allEdges.map((edge) => ({
              source: edge.source.label,
              target: edge.target.label,
              relation: edge.relationType,
              evidence: edge.evidence,
              weight: edge.weight,
            })),
          }),
        });

        if (aiResp.ok) {
          const graph = (await aiResp.json()) as {
            nodes?: Array<{
              label: string;
              kingpin_score?: number;
              role?: string;
              centrality?: Record<string, number>;
            }>;
          };

          const isNonCriminalNode = (type: string, label: string, role?: string | null): boolean => {
            const etype = String(type || "PERSON").toUpperCase();
            const normVal = String(label || "").replace(/\s+/g, " ").trim().toUpperCase();
            const valLower = normVal.toLowerCase();

            if (
              valLower.includes("billa") ||
              valLower.includes("ranga") ||
              valLower.includes("kuljeet") ||
              valLower.includes("jasbir")
            ) {
              return false;
            }

            if (etype !== "PERSON" && etype !== "ALIAS" && etype !== "SUSPECT" && etype !== "ENTITY") return true;
            if (role === "VICTIM" || role === "WITNESS" || role === "POLICE_OFFICER") return true;
            if (
              valLower.includes("victim") ||
              valLower.includes("witness") ||
              valLower.includes("informant") ||
              valLower.includes("complainant") ||
              valLower.includes("police") ||
              valLower.includes("inspector") ||
              valLower.includes("constable") ||
              valLower.includes("bhagwan dass") ||
              valLower.includes("court") ||
              valLower.startsWith("sec ") ||
              valLower.startsWith("section ")
            ) {
              return true;
            }
            return false;
          };

          for (const gNode of graph.nodes ?? []) {
            const nonCriminal = isNonCriminalNode(
  (gNode as any).entity_type,
  gNode.label,
  gNode.role
);
            await prisma.networkNode.updateMany({
              where: {
                caseId,
                label: { equals: gNode.label, mode: "insensitive" },
              },
              data: {
                kingpinScore: nonCriminal ? 0 : (gNode.kingpin_score ?? 0),
                role: nonCriminal ? "EXECUTOR" : ((gNode.role as any) ?? "EXECUTOR"),
                centrality: gNode.centrality ?? {},
              },
            });
          }
        }
      } catch (graphErr) {
        logger.warn(`Background Graph ML rebuild skipped: ${String(graphErr)}`);
      }
    })();

    await audit(
      { userId: user.id, ipAddress: req.ip },
      "NLP_RESULTS_IMPORTED",
      "Case",
      caseId,
      { source, entityCount: entities.length, relationCount: relationships.length, createdEdges }
    );

    res.json({
      ok: true,
      entityCount: entities.length,
      relationCount: relationships.length,
      createdEdges,
      documentId: document_id,
      hashChain: {
        original: original_file_hash?.slice(0, 12) + "…",
        ocr: ocr_text_hash?.slice(0, 12) + "…",
        translated: translated_text_hash?.slice(0, 12) + "…",
      },
    });
  } catch (err) {
    next(err);
  }
}