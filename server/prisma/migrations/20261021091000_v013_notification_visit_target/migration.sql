ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_single_target_check";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_single_target_check" CHECK (
  (("taskId" IS NOT NULL)::int + ("inventoryItemId" IS NOT NULL)::int + ("visitId" IS NOT NULL)::int) = 1
);