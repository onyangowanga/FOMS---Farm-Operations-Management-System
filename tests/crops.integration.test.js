import test from "node:test";
import assert from "node:assert/strict";
import { fixture, base, request } from "./helpers.js";

test("crop nursery planning, lifecycle history, irrigation, fertilizer and harvest persistence", { skip: !base }, async () => {
  const f = fixture();
  try {
    assert.equal((await request("/crops")).status, 401);
    const owner = await f.seed();
    const worker = await f.seed("WORKER", owner.organizationId);
    const outsider = await f.seed();
    const farm = (await request("/farms", "POST", { name: "Crop test farm" }, owner.cookie)).body.data;
    const type = await request("/crops/types", "POST", { name: "Onions", requiresNursery: true, nurseryDays: 45, maturityDays: 100 }, owner.cookie);
    assert.equal(type.status, 201);
    const payload = { farmId: farm.id, cropTypeId: type.body.data.id, cropName: "Onions", requiresNursery: true, nurseryDays: 45, nurseryDate: "2026-01-01", plantingDate: "2026-02-15", expectedHarvest: "2026-06-01" };
    assert.equal((await request("/crops", "POST", { ...payload, expectedHarvest: "2025-01-01" }, owner.cookie)).status, 400);
    const created = await request("/crops", "POST", payload, owner.cookie);
    assert.equal(created.status, 201);
    const id = created.body.data.id;
    assert.equal((await request(`/crops/${id}`, "GET", undefined, outsider.cookie)).status, 404);
    assert.equal((await request(`/crops/${id}/stages`, "POST", { stage: "NURSERY", occurredAt: new Date().toISOString(), notes: "Sown" }, worker.cookie)).status, 403);
    assert.equal((await request(`/crops/${id}`, "PATCH", { status: "HARVESTED" }, owner.cookie)).status, 400);
    for (const stage of ["NURSERY", "TRANSPLANTED", "GROWING", "HARVESTED"]) {
      const observed = new Date().toISOString();
      assert.equal((await request(`/crops/${id}/stages`, "POST", { stage, occurredAt: observed, notes: `Observed ${stage}` }, owner.cookie)).status, 201);
    }
    assert.equal((await request(`/crops/${id}/stages`, "POST", { stage: "GROWING", occurredAt: "2026-01-01", notes: "Out of sequence" }, owner.cookie)).status, 400);
    for (const record of [{ type: "IRRIGATION", quantity: 250, unit: "litres" }, { type: "FERTILIZER", quantity: 10, unit: "kg", product: "NPK" }, { type: "HARVEST", quantity: 400, unit: "kg" }]) {
      assert.equal((await request(`/crops/${id}/activities`, "POST", { ...record, occurredAt: "2026-06-01" }, owner.cookie)).status, 201);
    }
    const detail = (await request(`/crops/${id}`, "GET", undefined, worker.cookie)).body.data;
    assert.equal(detail.status, "HARVESTED");
    assert.equal(detail.stages.length, 5);
    assert.equal(detail.activities.length, 3);
    assert.equal(detail.activities.find((item) => item.type === "HARVEST").quantity, 400);
    const dashboard = (await request("/dashboard", "GET", undefined, owner.cookie)).body.data;
    assert.equal(dashboard.activeCropCount, 0);
    assert.equal(dashboard.cropCount, 1);
    assert.equal((await request(`/crops/${id}`, "PATCH", { transplantDate: "2026-02-16" }, owner.cookie)).status, 200);
    assert.equal((await request(`/crops/${id}`, "DELETE", undefined, owner.cookie)).status, 200);
    assert.equal((await request(`/crops/${id}`, "GET", undefined, owner.cookie)).status, 404);
  } finally { await f.cleanup(); }
});
