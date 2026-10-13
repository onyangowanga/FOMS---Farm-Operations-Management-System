ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'VOID';

CREATE TABLE "DailyBoard" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "headline" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "updatedBy" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyBoard_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DailyBoard_organizationId_key" ON "DailyBoard"("organizationId");
ALTER TABLE "DailyBoard" ADD CONSTRAINT "DailyBoard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
