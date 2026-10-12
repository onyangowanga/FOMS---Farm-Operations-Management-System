ALTER TABLE "InventoryItem"
  ALTER COLUMN "quantity" TYPE DECIMAL(15,3) USING ROUND("quantity"::numeric,3),
  ALTER COLUMN "reorderLevel" TYPE DECIMAL(15,3) USING ROUND("reorderLevel"::numeric,3),
  ADD COLUMN "trackingMode" TEXT NOT NULL DEFAULT 'BATCH',
  ADD COLUMN "assetCondition" TEXT,
  ADD COLUMN "conditionObservedAt" TIMESTAMP(3),
  ADD COLUMN "serialNumber" TEXT,
  ADD COLUMN "nextMaintenanceDate" TIMESTAMP(3),
  ADD COLUMN "lowStockAlertActive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "creationRequestId" UUID;
CREATE UNIQUE INDEX "InventoryItem_organizationId_creationRequestId_key" ON "InventoryItem"("organizationId","creationRequestId");

ALTER TABLE "StockMovement"
  ALTER COLUMN "quantity" TYPE DECIMAL(15,3) USING ROUND("quantity"::numeric,3),
  ADD COLUMN "balanceAfter" DECIMAL(15,3),
  ADD COLUMN "requestId" UUID,
  ADD COLUMN "occurredAt" TIMESTAMP(3);
UPDATE "StockMovement" SET "occurredAt" = "createdAt";
ALTER TABLE "StockMovement" ALTER COLUMN "occurredAt" SET NOT NULL, ALTER COLUMN "occurredAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "StockMovement_itemId_requestId_key" ON "StockMovement"("itemId","requestId");

CREATE TABLE "InventoryAssetEvent" (
  "id" UUID PRIMARY KEY,
  "organizationId" UUID NOT NULL,
  "itemId" UUID NOT NULL REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "requestId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "condition" TEXT NOT NULL,
  "notes" TEXT NOT NULL,
  "cost" DECIMAL(12,2),
  "observedAt" TIMESTAMP(3) NOT NULL,
  "nextMaintenanceDate" TIMESTAMP(3),
  "recordedBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "InventoryAssetEvent_itemId_requestId_key" ON "InventoryAssetEvent"("itemId","requestId");
CREATE INDEX "InventoryAssetEvent_organizationId_itemId_observedAt_idx" ON "InventoryAssetEvent"("organizationId","itemId","observedAt");
ALTER TABLE "Notification" ALTER COLUMN "taskId" DROP NOT NULL, ADD COLUMN "inventoryItemId" UUID REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_single_target_check" CHECK (("taskId" IS NULL) <> ("inventoryItemId" IS NULL));
