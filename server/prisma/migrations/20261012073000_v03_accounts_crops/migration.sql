ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
WITH prefixes AS (
  SELECT id, left(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9_.-]', '', 'g'), 40) AS prefix FROM "User"
), names AS (
  SELECT id, CASE WHEN length(prefix) < 3 THEN 'user' ELSE prefix END AS prefix FROM prefixes
)
UPDATE "User" u SET username = n.prefix || '.' || replace(u.id::text, '-', '') FROM names n WHERE u.id = n.id;
WITH prefixes AS (
  SELECT id, left(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9_.-]', '', 'g'), 40) AS prefix FROM "User"
), unique_names AS (
  SELECT prefix FROM prefixes WHERE length(prefix) >= 3 GROUP BY prefix HAVING count(*) = 1
)
UPDATE "User" u SET username = p.prefix FROM prefixes p JOIN unique_names n ON n.prefix = p.prefix
WHERE u.id = p.id AND NOT EXISTS (SELECT 1 FROM "User" other WHERE other.username = p.prefix AND other.id <> u.id);
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
ALTER TABLE "RefreshToken" ALTER COLUMN "organizationId" DROP NOT NULL;
ALTER TABLE "RefreshToken" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CropCycle" ADD COLUMN "cropTypeId" UUID;
ALTER TABLE "CropCycle" ADD COLUMN "requiresNursery" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CropCycle" ADD COLUMN "nurseryDays" INTEGER;
ALTER TABLE "CropCycle" ADD COLUMN "transplantDate" TIMESTAMP(3);
CREATE TABLE "CropType" (
  "id" UUID NOT NULL PRIMARY KEY, "organizationId" UUID NOT NULL, "name" TEXT NOT NULL,
  "requiresNursery" BOOLEAN NOT NULL DEFAULT false, "nurseryDays" INTEGER, "maturityDays" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CropType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "CropType_organizationId_name_key" ON "CropType"("organizationId", "name");
ALTER TABLE "CropCycle" ADD CONSTRAINT "CropCycle_cropTypeId_fkey" FOREIGN KEY ("cropTypeId") REFERENCES "CropType"("id") ON DELETE SET NULL;
CREATE TABLE "CropStage" (
  "id" UUID NOT NULL PRIMARY KEY, "cropId" UUID NOT NULL, "stage" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "notes" TEXT, "recordedBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CropStage_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "CropCycle"("id") ON DELETE CASCADE
);
CREATE INDEX "CropStage_cropId_occurredAt_idx" ON "CropStage"("cropId", "occurredAt");
INSERT INTO "CropStage" ("id", "cropId", "stage", "occurredAt", "notes", "recordedBy")
SELECT id, id, status, "createdAt", 'Stage at V0.3 migration', "createdBy" FROM "CropCycle";
CREATE TABLE "CropActivity" (
  "id" UUID NOT NULL PRIMARY KEY, "cropId" UUID NOT NULL, "type" TEXT NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL, "unit" TEXT NOT NULL, "product" TEXT, "notes" TEXT, "recordedBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CropActivity_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "CropCycle"("id") ON DELETE CASCADE
);
CREATE INDEX "CropActivity_cropId_occurredAt_idx" ON "CropActivity"("cropId", "occurredAt");
