import test from "node:test";
import assert from "node:assert/strict";
import { suggestCropSchedule } from "../client/js/crop-schedule.js";
import { activitySchema, cropSchema } from "../server/src/modules/resources/crop.validation.js";
import { fixture, base, request } from "./helpers.js";

test("yielding-day suggestions use field planting or actual transplant, not nursery sowing", () => {
  const values = { requiresNursery: true, nurseryDate: "2026-01-01", nurseryDays: 45, yieldingDays: 100 };
  assert.deepEqual(suggestCropSchedule(values), { transplant: "2026-02-15", harvest: "2026-05-26" });
  assert.equal(suggestCropSchedule({ ...values, plantingDate: "2026-02-20" }).harvest, "2026-05-31");
  assert.equal(suggestCropSchedule({ ...values, plantingDate: "2026-02-20", transplantDate: "2026-02-25" }).harvest, "2026-06-05");
  assert.deepEqual(suggestCropSchedule({ requiresNursery: false, plantingDate: "2026-01-01", yieldingDays: 30 }), { transplant: "", harvest: "2026-01-31" });
  assert.equal(suggestCropSchedule({ plantingDate: "2026-01-01", yieldingDays: "" }).harvest, "");
  for (const days of [0, -1, 1.5, 3651]) assert.equal(cropSchema.partial().safeParse({ yieldingDays: days }).success, false);
});
test("custom crop activity and units require explicit labels, while preserving existing unit rules", () => {
  const record = { type: "CUSTOM", customActivity: "Weeding", occurredAt: "2026-01-01", quantity: 2, unit: "OTHER", customUnit: "Hours" };
  assert.equal(activitySchema.parse(record).customUnit, "hours");
  for (const changes of [{ customActivity: null }, { customUnit: "" }, { quantity: 0 }, { occurredAt: "2999-01-01" }]) assert.equal(activitySchema.safeParse({ ...record, ...changes }).success, false);
  assert.equal(activitySchema.safeParse({ type: "IRRIGATION", unit: "kg", quantity: 2, occurredAt: "2026-01-01" }).success, false);
  assert.equal(activitySchema.safeParse({ type: "FERTILIZER", unit: "OTHER", customUnit: "sachets", quantity: 2, occurredAt: "2026-01-01" }).success, false);
});
test("yielding days and custom activities persist within the correct tenant", { skip: !base }, async () => {
  const f = fixture();
  try {
    assert.equal((await request("/crops")).status, 401);
    const owner = await f.seed();
    const outsider = await f.seed();
    const farm = (await request("/farms", "POST", { name: "Yielding test farm" }, owner.cookie)).body.data;
    const created = await request("/crops", "POST", { farmId: farm.id, cropName: "Onions", yieldingDays: 100, plantingDate: "2026-01-01", expectedHarvest: "2026-04-11" }, owner.cookie);
    assert.equal(created.status, 201);
    const path = `/crops/${created.body.data.id}`;
    assert.equal((await request(path, "PATCH", { yieldingDays: 120 }, owner.cookie)).status, 200);
    for (const activity of [
      { type: "CUSTOM", customActivity: "Weeding", quantity: 3, unit: "OTHER", customUnit: "worker hours" },
      { type: "HARVEST", quantity: 10, unit: "OTHER", customUnit: "Baskets" }
    ]) {
      assert.equal((await request(`${path}/activities`, "POST", { ...activity, occurredAt: "2026-01-01" }, outsider.cookie)).status, 404);
      assert.equal((await request(`${path}/activities`, "POST", { ...activity, occurredAt: "2026-01-01" }, owner.cookie)).status, 201);
    }
    const detail = (await request(path, "GET", undefined, owner.cookie)).body.data;
    assert.equal(detail.yieldingDays, 120);
    assert.equal(detail.activities.find((item) => item.type === "CUSTOM").customActivity, "Weeding");
    assert.equal(detail.activities.find((item) => item.type === "HARVEST").customUnit, "baskets");
  } finally { await f.cleanup(); }
});
