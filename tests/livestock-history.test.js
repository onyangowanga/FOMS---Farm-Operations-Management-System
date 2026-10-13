import test from "node:test";
import assert from "node:assert/strict";
import { base, fixture, request } from "./helpers.js";

test("vaccination, health, weight and poultry production persist history without backdated projection regressions", { skip: !base }, async () => {
  const f = fixture();
  try {
    assert.equal((await request("/livestock")).status, 401);
    const owner = await f.seed();
    const farm = (await request("/farms", "POST", { name: "Poultry history" }, owner.cookie)).body.data;
    const record = (await request("/livestock", "POST", { farmId: farm.id, species: "POULTRY", trackingMode: "BATCH", quantity: 20, birthDate: "2025-01-01" }, owner.cookie)).body.data;
    const path = `/livestock/${record.id}`;
    const events = [
      { type: "VACCINATION", title: "Newcastle", quantity: 20, occurredAt: "2026-02-01", nextDueAt: "2026-03-01", notes: "Booster planned" },
      { type: "VACCINATION", title: "Earlier vaccine", quantity: 20, occurredAt: "2026-01-01" },
      { type: "HEALTH", title: "Recovery", healthStatus: "HEALTHY", occurredAt: "2026-02-01" },
      { type: "HEALTH", title: "Earlier illness", healthStatus: "SICK", occurredAt: "2026-01-01" },
      { type: "WEIGHT", weightKg: 1.8, occurredAt: "2026-02-01" },
      { type: "WEIGHT", weightKg: 1.3, occurredAt: "2026-01-01" },
      { type: "FEED", title: "Layers mash", feedKg: 2.5, occurredAt: "2026-02-01" },
      { type: "FEED", title: "Layers mash", feedKg: 1.25, occurredAt: "2026-02-02" },
      { type: "EGG_PRODUCTION", quantity: 15, occurredAt: "2026-02-01" },
      { type: "EGG_PRODUCTION", quantity: 18, occurredAt: "2026-02-02" }
    ];
    assert.equal((await request(`${path}/events`, "POST", events[0])).status, 401);
    for (const event of events) assert.equal((await request(`${path}/events`, "POST", event, owner.cookie)).status, 201);
    const result = (await request(path, "GET", undefined, owner.cookie)).body.data;
    assert.equal(result.lastVaccinated, "2026-02-01T00:00:00.000Z");
    assert.equal(result.healthStatus, "HEALTHY");
    assert.equal(result.weightKg, 1.8);
    assert.deepEqual(result.totals, { mortality: 0, feedKg: 3.75, eggs: 33, births: 0, purchases: 0, sales: 0 });
    assert.equal((await request(`${path}/events?limit=3&page=2`, "GET", undefined, owner.cookie)).body.meta.total, 10);
    assert.equal((await request(`${path}/events`, "GET", undefined, owner.cookie)).body.data.find((item) => item.type === "VACCINATION" && item.title === "Newcastle").nextDueAt, "2026-03-01T00:00:00.000Z");
    assert.equal((await request(path, "PATCH", { healthStatus: "SICK" }, owner.cookie)).status, 409);
    assert.equal((await request(path, "PATCH", { quantity: 10 }, owner.cookie)).status, 409);
    assert.equal((await request(path, "PATCH", { birthDate: "2026-02-02" }, owner.cookie)).status, 400);
    assert.equal((await request(`${path}/events`, "POST", { ...events[0], quantity: 21 }, owner.cookie)).status, 409);
    assert.equal((await request(`${path}/events`, "POST", { ...events[2], occurredAt: "2024-01-01" }, owner.cookie)).status, 400);
    const goat = (await request("/livestock", "POST", { farmId: farm.id, species: "GOAT" }, owner.cookie)).body.data;
    assert.equal((await request(`/livestock/${goat.id}/events`, "POST", events[6], owner.cookie)).status, 400);
    assert.equal((await request(`/livestock/${goat.id}/events`, "POST", events[8], owner.cookie)).status, 400);
    assert.equal((await request(`/livestock/${goat.id}/events`, "GET", undefined, owner.cookie)).body.meta.total, 0);
  } finally { await f.cleanup(); }
});
