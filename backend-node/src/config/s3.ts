/**
 * AWS S3 — presigned URL generation for evidence uploads.
 * Uses aws-sdk v2 (promise-compatible). Works with any S3-compatible store
 * when access keys are configured; otherwise returns a local fallback URL.
 */
import AWS from "aws-sdk";
import { env } from "./env";
import { logger } from "../utils/logger";

let s3: AWS.S3 | null = null;
if (env.aws.accessKeyId && env.aws.secretAccessKey) {
  s3 = new AWS.S3({
    region: env.aws.region,
    accessKeyId: env.aws.accessKeyId,
    secretAccessKey: env.aws.secretAccessKey,
    signatureVersion: "v4",
  });
} else {
  logger.warn("AWS credentials not configured — presigned uploads will be simulated (local mode)");
}

export interface PresignedResult {
  uploadUrl: string;
  getUrl: string;
  key: string;
}

/**
 * Create a presigned PUT URL (expires 15 min) + a public GET URL for an
 * evidence object. `contentType` must match the upload request.
 */
export async function createPresignedUpload(
  caseId: string,
  fileName: string,
  contentType: string,
  expiresSec = 900
): Promise<PresignedResult> {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `cases/${caseId}/${Date.now()}-${safeName}`;

  if (!s3) {
    // Local demo mode: point the client at the backend's own upload endpoint.
    return {
      uploadUrl: `/api/evidence/local-upload?key=${encodeURIComponent(key)}`,
      getUrl: `/api/evidence/object/${encodeURIComponent(key)}`,
      key,
    };
  }

  const uploadUrl = s3.getSignedUrl("putObject", {
    Bucket: env.aws.bucket,
    Key: key,
    ContentType: contentType,
    Expires: expiresSec,
  });
  const getUrl = `https://${env.aws.bucket}.s3.${env.aws.region}.amazonaws.com/${key}`;
  return { uploadUrl, getUrl, key };
}

export { s3 };
