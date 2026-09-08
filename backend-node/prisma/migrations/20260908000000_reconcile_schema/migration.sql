-- CreateEnum
CREATE TYPE "PersonRole" AS ENUM ('VICTIM', 'WITNESS', 'ACCUSED', 'ASSOCIATE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('FIR', 'CDR', 'BANK_STATEMENT', 'SURVEILLANCE_NOTE', 'OSINT_CAPTURE', 'COMPLAINT');

-- CreateEnum
CREATE TYPE "OCRStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TranslationStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'SKIPPED_NOT_NEEDED');

-- CreateEnum
CREATE TYPE "ResolutionDecision" AS ENUM ('MERGE', 'SPLIT', 'REVIEW', 'AUTO_MERGED', 'AUTO_REJECTED');

-- CreateEnum
CREATE TYPE "AdmissibilityStatus" AS ENUM ('CERTIFIED', 'DEFECTIVE', 'DEMANDED_NOT_GIVEN', 'NOT_SOUGHT', 'PENDING');

-- CreateEnum
CREATE TYPE "TimelineState" AS ENUM ('RECORDED', 'DELAYED', 'IMPOSSIBLE', 'ABSENT');

-- CreateEnum
CREATE TYPE "EdgeInkType" AS ENUM ('OBSERVED', 'PREDICTED', 'HYPOTHESISED');

-- CreateEnum
CREATE TYPE "ScenePlacementStatus" AS ENUM ('DOCUMENTED', 'INFERRED', 'MANUAL', 'UNPLACED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RelationType" ADD VALUE 'co_accused';
ALTER TYPE "RelationType" ADD VALUE 'victim_of';
ALTER TYPE "RelationType" ADD VALUE 'witness_to';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "caseId" TEXT,
ADD COLUMN     "details" JSONB,
ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "entityType" DROP NOT NULL,
ALTER COLUMN "entityId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "attributes" JSONB;

-- AlterTable
ALTER TABLE "NetworkEdge" ADD COLUMN     "inkType" "EdgeInkType" NOT NULL DEFAULT 'OBSERVED',
ADD COLUMN     "isVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mechanism" TEXT NOT NULL DEFAULT 'LLM',
ADD COLUMN     "sourceDocId" TEXT;

-- AlterTable
ALTER TABLE "NetworkNode" ADD COLUMN     "aliases" JSONB,
ADD COLUMN     "attributes" JSONB,
ADD COLUMN     "canonicalName" TEXT,
ADD COLUMN     "entityType" TEXT NOT NULL DEFAULT 'PERSON',
ADD COLUMN     "personRole" "PersonRole" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "provenanceId" TEXT,
ADD COLUMN     "roleSource" TEXT,
ADD COLUMN     "sourceLanguage" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "NetworkNode" n
SET "entityType" = e."type"::text
FROM "Entity" e
WHERE n."entityId" = e."id";

-- CreateTable
CREATE TABLE "DocumentProvenance" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "ingestionHash" TEXT NOT NULL,
    "ingestionTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawOcrText" TEXT,
    "rawOcrHash" TEXT,
    "ocrLanguage" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "ocrStatus" "OCRStatus" NOT NULL DEFAULT 'PENDING',
    "ocrPageCount" INTEGER,
    "translatedText" TEXT,
    "translatedHash" TEXT,
    "sourceLanguage" TEXT,
    "translationModel" TEXT,
    "translationStatus" "TranslationStatus" NOT NULL DEFAULT 'PENDING',
    "extractedEntities" JSONB,
    "nerModel" TEXT,
    "relationshipSource" TEXT,
    "admissibility" "AdmissibilityStatus" NOT NULL DEFAULT 'PENDING',
    "pipelineVersion" TEXT NOT NULL DEFAULT 'v2.1-ocr-splink',
    "processedAt" TIMESTAMP(3),
    "eventTime" TIMESTAMP(3),
    "recordTime" TIMESTAMP(3),
    "timelineState" "TimelineState" NOT NULL DEFAULT 'RECORDED',
    "documentId" TEXT NOT NULL,

    CONSTRAINT "DocumentProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityResolutionLog" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "sourceEntityName" TEXT NOT NULL,
    "targetEntityName" TEXT NOT NULL,
    "sourceNodeId" TEXT,
    "matchWeight" DOUBLE PRECISION NOT NULL,
    "matchProbability" DOUBLE PRECISION NOT NULL,
    "decision" "ResolutionDecision" NOT NULL,
    "fieldScores" JSONB NOT NULL,
    "blockingKey" TEXT,
    "decidedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityResolutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fileUrl" TEXT,
    "hash" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "caseId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "intent" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneEvidencePlacement" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "room" TEXT NOT NULL DEFAULT 'MAIN',
    "status" "ScenePlacementStatus" NOT NULL DEFAULT 'UNPLACED',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "aiInferred" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "placedById" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SceneEvidencePlacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentProvenance_documentId_key" ON "DocumentProvenance"("documentId");

-- CreateIndex
CREATE INDEX "DocumentProvenance_caseId_idx" ON "DocumentProvenance"("caseId");

-- CreateIndex
CREATE INDEX "DocumentProvenance_ingestionHash_idx" ON "DocumentProvenance"("ingestionHash");

-- CreateIndex
CREATE INDEX "EntityResolutionLog_caseId_idx" ON "EntityResolutionLog"("caseId");

-- CreateIndex
CREATE INDEX "EntityResolutionLog_sourceEntityName_targetEntityName_idx" ON "EntityResolutionLog"("sourceEntityName", "targetEntityName");

-- CreateIndex
CREATE INDEX "EvidenceItem_caseId_idx" ON "EvidenceItem"("caseId");

-- CreateIndex
CREATE INDEX "ChatConversation_userId_idx" ON "ChatConversation"("userId");

-- CreateIndex
CREATE INDEX "ChatConversation_caseId_idx" ON "ChatConversation"("caseId");

-- CreateIndex
CREATE INDEX "ChatConversation_updatedAt_idx" ON "ChatConversation"("updatedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_idx" ON "ChatMessage"("conversationId");

-- CreateIndex
CREATE INDEX "ChatMessage_createdAt_idx" ON "ChatMessage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SceneEvidencePlacement_evidenceId_key" ON "SceneEvidencePlacement"("evidenceId");

-- CreateIndex
CREATE INDEX "SceneEvidencePlacement_caseId_idx" ON "SceneEvidencePlacement"("caseId");

-- CreateIndex
CREATE INDEX "SceneEvidencePlacement_status_idx" ON "SceneEvidencePlacement"("status");

-- CreateIndex
CREATE INDEX "AuditLog_caseId_idx" ON "AuditLog"("caseId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "NetworkNode_entityType_idx" ON "NetworkNode"("entityType");

-- CreateIndex
CREATE INDEX "NetworkNode_canonicalName_idx" ON "NetworkNode"("canonicalName");

-- CreateIndex
CREATE INDEX "NetworkNode_entityId_idx" ON "NetworkNode"("entityId");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentProvenance" ADD CONSTRAINT "DocumentProvenance_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityResolutionLog" ADD CONSTRAINT "EntityResolutionLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkNode" ADD CONSTRAINT "NetworkNode_provenanceId_fkey" FOREIGN KEY ("provenanceId") REFERENCES "DocumentProvenance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneEvidencePlacement" ADD CONSTRAINT "SceneEvidencePlacement_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneEvidencePlacement" ADD CONSTRAINT "SceneEvidencePlacement_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneEvidencePlacement" ADD CONSTRAINT "SceneEvidencePlacement_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

