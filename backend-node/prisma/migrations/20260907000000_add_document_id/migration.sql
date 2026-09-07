-- Add documentId to DocumentProvenance.
-- DocumentProvenance currently contains zero rows.

ALTER TABLE "DocumentProvenance"
ADD COLUMN "documentId" TEXT NOT NULL;

CREATE UNIQUE INDEX "DocumentProvenance_documentId_key"
ON "DocumentProvenance"("documentId");
