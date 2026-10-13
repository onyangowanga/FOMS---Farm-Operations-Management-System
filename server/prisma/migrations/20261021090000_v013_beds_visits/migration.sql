ALTER TABLE "CropCycle" ADD COLUMN "bedCount" INTEGER;

CREATE TABLE "FarmVisit" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID,
    "agronomistId" UUID NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "source" TEXT NOT NULL DEFAULT 'AGRONOMIST',
    "purpose" TEXT,
    "findings" TEXT,
    "cancelReason" TEXT,
    "requestedBy" UUID,
    "completedAt" TIMESTAMP(3),
    "completedBy" UUID,
    "reminderSentAt" TIMESTAMP(3),
    "overdueSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FarmVisit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FarmVisit_organizationId_status_scheduledFor_idx" ON "FarmVisit"("organizationId", "status", "scheduledFor");
CREATE INDEX "FarmVisit_agronomistId_status_scheduledFor_idx" ON "FarmVisit"("agronomistId", "status", "scheduledFor");
ALTER TABLE "FarmVisit" ADD CONSTRAINT "FarmVisit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FarmVisit" ADD CONSTRAINT "FarmVisit_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FarmVisit" ADD CONSTRAINT "FarmVisit_agronomistId_fkey" FOREIGN KEY ("agronomistId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD COLUMN "visitId" UUID;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "FarmVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;