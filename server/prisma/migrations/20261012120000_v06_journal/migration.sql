CREATE TYPE "JournalIncidentStatus" AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE "JournalIncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

ALTER TABLE "JournalEntry"
  ADD COLUMN "incidentStatus" "JournalIncidentStatus",
  ADD COLUMN "incidentSeverity" "JournalIncidentSeverity",
  ADD COLUMN "incidentUpdatedAt" TIMESTAMP(3);

UPDATE "JournalEntry"
SET "incidentStatus" = 'OPEN', "incidentUpdatedAt" = "observedAt"
WHERE "category" = 'PEST_DISEASE' OR NULLIF(BTRIM("incident"), '') IS NOT NULL;

CREATE TABLE "JournalFollowUp" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "journalEntryId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "notes" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "incidentStatus" "JournalIncidentStatus" NOT NULL,
  "incidentSeverity" "JournalIncidentSeverity",
  "recordedBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalFollowUp_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JournalFollowUp_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JournalFollowUp_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "JournalFollowUp_journalEntryId_requestId_key" ON "JournalFollowUp"("journalEntryId", "requestId");
CREATE INDEX "JournalFollowUp_organizationId_journalEntryId_observedAt_idx" ON "JournalFollowUp"("organizationId", "journalEntryId", "observedAt");
