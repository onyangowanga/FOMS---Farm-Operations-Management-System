ALTER TABLE "LivestockEvent"
  DROP CONSTRAINT "LivestockEvent_type_check",
  ADD CONSTRAINT "LivestockEvent_type_check"
    CHECK ("type" IN ('VACCINATION', 'HEALTH', 'WEIGHT', 'MORTALITY', 'FEED', 'EGG_PRODUCTION', 'PURCHASE', 'BIRTH', 'BREEDING', 'SALE'));

ALTER TABLE "Expense"
  ADD COLUMN "livestockEventId" UUID,
  ADD CONSTRAINT "Expense_livestockEventId_key" UNIQUE ("livestockEventId"),
  ADD CONSTRAINT "Expense_livestockEventId_fkey"
    FOREIGN KEY ("livestockEventId") REFERENCES "LivestockEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Sale"
  ADD COLUMN "livestockEventId" UUID,
  ADD CONSTRAINT "Sale_livestockEventId_key" UNIQUE ("livestockEventId"),
  ADD CONSTRAINT "Sale_livestockEventId_fkey"
    FOREIGN KEY ("livestockEventId") REFERENCES "LivestockEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
