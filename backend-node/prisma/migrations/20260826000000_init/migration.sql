-- CreateEnum
CREATE TYPE "Role" AS ENUM ('INVESTIGATOR', 'DSP', 'SP', 'DGP');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'UNDER_INVESTIGATION', 'PENDING_REVIEW', 'CLOSED', 'COLD');

-- CreateEnum
CREATE TYPE "CasePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('PERSON', 'LOCATION', 'PHONE', 'VEHICLE', 'ORGANIZATION', 'BANK_ACCOUNT', 'DATE', 'ALIAS');

-- CreateEnum
CREATE TYPE "GraphRole" AS ENUM ('KINGPIN', 'BROKER', 'EXECUTOR');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('phone_call', 'financial_transfer', 'family', 'associate', 'same_organization', 'co_location');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('FIR', 'CDR', 'BANK', 'PHOTO', 'DOCUMENT', 'CCTV');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('ANOMALY', 'HIGH_RISK', 'GHOST_LINK', 'CROSS_REFERENCE', 'NETWORK_UPDATE', 'EVIDENCE_UPLOAD', 'LAUNDERING_RISK');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'INVESTIGATOR',
    "department" TEXT NOT NULL DEFAULT '',
    "badgeNumber" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "CasePriority" NOT NULL DEFAULT 'MEDIUM',
    "jurisdiction" TEXT NOT NULL DEFAULT '',
    "assignedInvestigatorId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suspect" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "dob" TIMESTAMP(3),
    "gender" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "phoneNumbers" TEXT[],
    "photoUrl" TEXT NOT NULL DEFAULT '',
    "criminalHistory" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kingpinScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "role" "GraphRole" NOT NULL DEFAULT 'EXECUTOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" "EntityType" NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "extractedFrom" TEXT NOT NULL DEFAULT '',
    "layer" TEXT NOT NULL DEFAULT 'spacy',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkNode" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "entityId" TEXT,
    "label" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "kingpinScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "role" "GraphRole" NOT NULL DEFAULT 'EXECUTOR',
    "centrality" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkEdge" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relationType" "RelationType" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "evidence" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "s3Url" TEXT NOT NULL DEFAULT '',
    "sha256Hash" TEXT NOT NULL DEFAULT '',
    "uploadedBy" TEXT NOT NULL,
    "gpsLat" DOUBLE PRECISION,
    "gpsLng" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromAccount" TEXT NOT NULL,
    "toAccount" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transactionType" TEXT NOT NULL DEFAULT 'NEFT',
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallRecord" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "callTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cellTower" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "CallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'MEDIUM',
    "message" TEXT NOT NULL,
    "data" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModusOperandi" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fingerprint" JSONB NOT NULL,
    "similarCaseIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModusOperandi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dossier" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "s3Url" TEXT NOT NULL DEFAULT '',
    "localPath" TEXT NOT NULL DEFAULT '',
    "sha256Hash" TEXT NOT NULL DEFAULT '',
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dossier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CaseSuspects" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Case_caseNumber_key" ON "Case"("caseNumber");

-- CreateIndex
CREATE INDEX "Case_assignedInvestigatorId_idx" ON "Case"("assignedInvestigatorId");

-- CreateIndex
CREATE INDEX "Case_status_idx" ON "Case"("status");

-- CreateIndex
CREATE INDEX "Case_jurisdiction_idx" ON "Case"("jurisdiction");

-- CreateIndex
CREATE INDEX "Case_createdAt_idx" ON "Case"("createdAt");

-- CreateIndex
CREATE INDEX "Suspect_name_idx" ON "Suspect"("name");

-- CreateIndex
CREATE INDEX "Suspect_kingpinScore_idx" ON "Suspect"("kingpinScore");

-- CreateIndex
CREATE INDEX "Entity_caseId_idx" ON "Entity"("caseId");

-- CreateIndex
CREATE INDEX "Entity_type_value_idx" ON "Entity"("type", "value");

-- CreateIndex
CREATE INDEX "Entity_value_idx" ON "Entity"("value");

-- CreateIndex
CREATE INDEX "NetworkNode_caseId_idx" ON "NetworkNode"("caseId");

-- CreateIndex
CREATE INDEX "NetworkNode_role_idx" ON "NetworkNode"("role");

-- CreateIndex
CREATE INDEX "NetworkEdge_caseId_idx" ON "NetworkEdge"("caseId");

-- CreateIndex
CREATE INDEX "NetworkEdge_sourceId_idx" ON "NetworkEdge"("sourceId");

-- CreateIndex
CREATE INDEX "NetworkEdge_targetId_idx" ON "NetworkEdge"("targetId");

-- CreateIndex
CREATE INDEX "Evidence_caseId_idx" ON "Evidence"("caseId");

-- CreateIndex
CREATE INDEX "Evidence_sha256Hash_idx" ON "Evidence"("sha256Hash");

-- CreateIndex
CREATE INDEX "Evidence_uploadedBy_idx" ON "Evidence"("uploadedBy");

-- CreateIndex
CREATE INDEX "Transaction_caseId_idx" ON "Transaction"("caseId");

-- CreateIndex
CREATE INDEX "Transaction_fromAccount_idx" ON "Transaction"("fromAccount");

-- CreateIndex
CREATE INDEX "Transaction_toAccount_idx" ON "Transaction"("toAccount");

-- CreateIndex
CREATE INDEX "Transaction_timestamp_idx" ON "Transaction"("timestamp");

-- CreateIndex
CREATE INDEX "CallRecord_caseId_idx" ON "CallRecord"("caseId");

-- CreateIndex
CREATE INDEX "CallRecord_fromNumber_idx" ON "CallRecord"("fromNumber");

-- CreateIndex
CREATE INDEX "CallRecord_toNumber_idx" ON "CallRecord"("toNumber");

-- CreateIndex
CREATE INDEX "Alert_caseId_idx" ON "Alert"("caseId");

-- CreateIndex
CREATE INDEX "Alert_resolved_idx" ON "Alert"("resolved");

-- CreateIndex
CREATE INDEX "Alert_createdAt_idx" ON "Alert"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModusOperandi_caseId_key" ON "ModusOperandi"("caseId");

-- CreateIndex
CREATE INDEX "ModusOperandi_caseId_idx" ON "ModusOperandi"("caseId");

-- CreateIndex
CREATE INDEX "Dossier_caseId_idx" ON "Dossier"("caseId");

-- CreateIndex
CREATE INDEX "Dossier_generatedBy_idx" ON "Dossier"("generatedBy");

-- CreateIndex
CREATE UNIQUE INDEX "_CaseSuspects_AB_unique" ON "_CaseSuspects"("A", "B");

-- CreateIndex
CREATE INDEX "_CaseSuspects_B_index" ON "_CaseSuspects"("B");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_assignedInvestigatorId_fkey" FOREIGN KEY ("assignedInvestigatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkNode" ADD CONSTRAINT "NetworkNode_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkNode" ADD CONSTRAINT "NetworkNode_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkEdge" ADD CONSTRAINT "NetworkEdge_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkEdge" ADD CONSTRAINT "NetworkEdge_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "NetworkNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkEdge" ADD CONSTRAINT "NetworkEdge_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "NetworkNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModusOperandi" ADD CONSTRAINT "ModusOperandi_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dossier" ADD CONSTRAINT "Dossier_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dossier" ADD CONSTRAINT "Dossier_generatedBy_fkey" FOREIGN KEY ("generatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CaseSuspects" ADD CONSTRAINT "_CaseSuspects_A_fkey" FOREIGN KEY ("A") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CaseSuspects" ADD CONSTRAINT "_CaseSuspects_B_fkey" FOREIGN KEY ("B") REFERENCES "Suspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

