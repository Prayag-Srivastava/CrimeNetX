/**
 * Evidence controller — presigned S3 URLs, metadata + SHA-256 chain of custody.
 */
import { NextFunction, Request, Response } from "express";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { EvidenceType } from "@prisma/client";
import { prisma } from "../config/prisma";
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
