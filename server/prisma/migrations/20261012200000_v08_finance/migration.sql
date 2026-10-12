ALTER TABLE "Expense"
  ALTER COLUMN "amount" TYPE DECIMAL(12,2) USING ROUND("amount"::numeric,2),
  ADD COLUMN "approvedBy" UUID,
  ADD COLUMN "requestId" UUID,
  ADD COLUMN "requestHash" TEXT;
ALTER TABLE "Sale" ADD COLUMN "requestId" UUID, ADD COLUMN "requestHash" TEXT;
ALTER TABLE "Payment" ADD COLUMN "requestId" UUID, ADD COLUMN "requestHash" TEXT;
CREATE UNIQUE INDEX "Expense_organizationId_requestId_key" ON "Expense"("organizationId","requestId");
CREATE UNIQUE INDEX "Sale_organizationId_requestId_key" ON "Sale"("organizationId","requestId");
CREATE UNIQUE INDEX "Payment_organizationId_requestId_key" ON "Payment"("organizationId","requestId");
CREATE TABLE "ExpenseAttachment" (
  "id" UUID PRIMARY KEY,
  "expenseId" UUID NOT NULL REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organizationId" UUID NOT NULL,
  "originalName" TEXT NOT NULL,
  "storageName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "uploadedBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3)
);
CREATE INDEX "ExpenseAttachment_expenseId_deletedAt_idx" ON "ExpenseAttachment"("expenseId","deletedAt");
