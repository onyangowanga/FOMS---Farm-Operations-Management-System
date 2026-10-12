import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { base, fixture, request } from "./helpers.js";

test("mortality serializes deductions, prevents replay/overdraw and updates living dashboard totals", { skip: !base }, async () => {
  const f = fixture();
  try {
    assert.equal((await request("/livestock")).status, 401);
    const owner = await f.seed();
    const outsider = await f.seed();
    const farm = (await request("/farms", "POST", { name: "Mortality tracking" }, owner.cookie)).body.data;
    const batch = (await request("/livestock", "POST", { farmId: farm.id, species: "SHEEP", trackingMode: "BATCH", quantity: 10 }, owner.cookie)).body.data;
    const path = `/livestock/${batch.id}`;
    const event = { type: "MORTALITY", title: "Unknown", quantity: 7, occurredAt: "2026-01-01", requestId: crypto.randomUUID() };
    assert.equal((await request(`${path}/events`, "POST", event)).status, 401);
    assert.equal((await request(`${path}/events`, "POST", event, outsider.cookie)).status, 404);
    const concurrent = await Promise.all([request(`${path}/events`, "POST", event, owner.cookie), request(`${path}/events`, "POST", { ...event, requestId: crypto.randomUUID() }, owner.cookie)]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [201, 409]);
    const success = concurrent.find((result) => result.status === 201).body.data;
    const replay = { ...event, requestId: success.id };
    assert.equal((await request(`${path}/events`, "POST", replay, owner.cookie)).status, 201);
    assert.equal((await request(`${path}/events`, "POST", { ...replay, quantity: 1 }, owner.cookie)).status, 409);
    let result = (await request(path, "GET", undefined, owner.cookie)).body.data;
    assert.equal(result.quantity, 3);
    assert.equal(result.initialQuantity, 10);
    assert.equal(result.totals.mortality, 7);
    assert.equal((await request(path, "PATCH", { quantity: 10 }, owner.cookie)).status, 409);
    assert.equal((await request("/dashboard", "GET", undefined, owner.cookie)).body.data.livestock.sheep, 3);
    const final = { ...event, quantity: 3, requestId: crypto.randomUUID() };
    assert.equal((await request(`${path}/events`, "POST", final, owner.cookie)).status, 201);
    result = (await request(path, "GET", undefined, owner.cookie)).body.data;
    assert.equal(result.quantity, 0);
    assert.equal(result.healthStatus, "DECEASED");
    assert.equal(result.totals.mortality, 10);
    assert.equal((await request(`${path}/events`, "POST", final, owner.cookie)).status, 201);
    assert.equal((await request(`${path}/events`, "POST", { type: "HEALTH", title: "Resurrect", healthStatus: "HEALTHY", occurredAt: "2026-02-01" }, owner.cookie)).status, 409);
    assert.equal((await request(path, "PATCH", { quantity: 1 }, owner.cookie)).status, 409);
    assert.equal((await request(`${path}/events`, "GET", undefined, owner.cookie)).body.meta.total, 2);
    assert.equal((await request("/dashboard", "GET", undefined, owner.cookie)).body.data.livestock.sheep || 0, 0);
    const individual = (await request("/livestock", "POST", { farmId: farm.id, species: "GOAT", trackingMode: "INDIVIDUAL" }, owner.cookie)).body.data;
    assert.equal((await request(`/livestock/${individual.id}/events`, "POST", { ...event, quantity: 2, requestId: crypto.randomUUID() }, owner.cookie)).status, 409);
    assert.equal((await request(`/livestock/${individual.id}/events`, "POST", { ...event, quantity: 1, requestId: crypto.randomUUID() }, owner.cookie)).status, 201);
    assert.equal((await request(`/livestock/${individual.id}`, "GET", undefined, owner.cookie)).body.data.quantity, 0);
  } finally { await f.cleanup(); }
});
