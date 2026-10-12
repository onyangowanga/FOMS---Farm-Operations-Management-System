import test from "node:test";
import assert from "node:assert/strict";
import { validateCropDates, activitySchema } from "../server/src/modules/resources/crop.validation.js";

test("nursery and harvest dates preserve chronological order", () => {
  const crop = { requiresNursery: true, nurseryDate: "2026-01-01", nurseryDays: 45, plantingDate: "2026-02-15", transplantDate: "2026-02-16", expectedHarvest: "2026-06-01", status: "NURSERY" };
  assert.doesNotThrow(() => validateCropDates(crop));
  for (const change of [{ nurseryDays: null }, { nurseryDate: null }, { plantingDate: "2025-12-01" }, { transplantDate: "2025-12-01" }, { expectedHarvest: "2026-02-01" }, { requiresNursery: false }]) assert.throws(() => validateCropDates({ ...crop, ...change }));
  assert.doesNotThrow(() => validateCropDates({ status: "GROWING", plantingDate: "2026-01-01", expectedHarvest: "2026-03-01" }));
});
test("crop activities validate quantities, product and compatible units", () => {
  const record = { type: "IRRIGATION", occurredAt: "2026-01-01", quantity: 120, unit: "litres" };
  assert.equal(activitySchema.safeParse(record).success, true);
  for (const change of [{ quantity: 0 }, { unit: "bags" }, { occurredAt: "2099-01-01" }, { type: "FERTILIZER" }]) assert.equal(activitySchema.safeParse({ ...record, ...change }).success, false);
  assert.equal(activitySchema.safeParse({ ...record, type: "FERTILIZER", product: "NPK", unit: "kg" }).success, true);
});
