ALTER TABLE "Task"
  ADD COLUMN "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "submissionNotes" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedBy" UUID;

CREATE TABLE "TaskEvidence" (
  "id" UUID NOT NULL PRIMARY KEY,
  "taskId" UUID NOT NULL,
  "storageName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "uploadedBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "TaskEvidence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TaskEvidence_taskId_deletedAt_createdAt_idx" ON "TaskEvidence"("taskId", "deletedAt", "createdAt");

CREATE TABLE "TaskEvent" (
  "id" UUID NOT NULL PRIMARY KEY,
  "taskId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "fromStatus" "TaskStatus",
  "toStatus" "TaskStatus",
  "notes" TEXT,
  "recordedBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TaskEvent_taskId_createdAt_id_idx" ON "TaskEvent"("taskId", "createdAt", "id");

CREATE TABLE "Notification" (
  "id" UUID NOT NULL PRIMARY KEY,
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "taskId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Notification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Notification_organizationId_userId_readAt_createdAt_idx" ON "Notification"("organizationId", "userId", "readAt", "createdAt");
