ALTER TABLE "Livestock"
  ADD COLUMN "trackingMode" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
  ADD COLUMN "initialQuantity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "healthObservedAt" TIMESTAMP(3),
  ADD COLUMN "weightObservedAt" TIMESTAMP(3);

UPDATE "Livestock"
SET "trackingMode" = CASE WHEN "quantity" > 1 THEN 'BATCH' ELSE 'INDIVIDUAL' END,
    "initialQuantity" = "quantity",
    "quantity" = CASE WHEN "healthStatus" = 'DECEASED' THEN 0 ELSE "quantity" END;

ALTER TABLE "Livestock"
  ADD CONSTRAINT "Livestock_quantity_check" CHECK ("quantity" >= 0 AND "quantity" <= "initialQuantity"),
  ADD CONSTRAINT "Livestock_tracking_check" CHECK ("trackingMode" IN ('INDIVIDUAL', 'BATCH') AND ("trackingMode" <> 'INDIVIDUAL' OR "initialQuantity" = 1));

CREATE TABLE "LivestockEvent" (
  "id" UUID NOT NULL,
  "livestockId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "title" TEXT,
  "quantity" INTEGER,
  "weightKg" DOUBLE PRECISION,
  "feedKg" DOUBLE PRECISION,
  "healthStatus" TEXT,
  "nextDueAt" TIMESTAMP(3),
  "notes" TEXT,
  "recordedBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LivestockEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LivestockEvent_type_check" CHECK ("type" IN ('VACCINATION', 'HEALTH', 'WEIGHT', 'MORTALITY', 'FEED', 'EGG_PRODUCTION')),
  CONSTRAINT "LivestockEvent_livestockId_fkey" FOREIGN KEY ("livestockId") REFERENCES "Livestock"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LivestockEvent_livestockId_occurredAt_id_idx" ON "LivestockEvent"("livestockId", "occurredAt", "id");
