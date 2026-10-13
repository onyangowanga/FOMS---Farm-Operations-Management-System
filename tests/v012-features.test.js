import test from "node:test";
import assert from "node:assert/strict";
import { base, fixture, request } from "./helpers.js";

test("tasks can be voided by managers only, with a reason, and are then frozen", { skip: !base }, async () => {
  const f = fixture();
  try {
    const owner = await f.seed();
    const worker = await f.seed("WORKER", owner.organizationId);
    const task = (await request("/tasks", "POST", { title: "Weed block A", assignedTo: worker.user.id }, owner.cookie)).body.data;
    const path = `/tasks/${task.id}/void`;
    assert.equal((await request(path, "POST", { reason: "Duplicate" }, worker.cookie)).status, 403);
    assert.equal((await request(path, "POST", {}, owner.cookie)).status, 400);
    const voided = await request(path, "POST", { reason: "Duplicate task" }, owner.cookie);
    assert.equal(voided.status, 200);
    assert.equal(voided.body.data.status, "VOID");
    assert.equal((await request(path, "POST", { reason: "Again please" }, owner.cookie)).status, 409);
    assert.equal((await request(`/tasks/${task.id}`, "PATCH", { title: "Edit" }, owner.cookie)).status, 409);
    assert.equal((await request(`/tasks/${task.id}/status`, "POST", { status: "IN_PROGRESS" }, worker.cookie)).status, 409);
  } finally { await f.cleanup(); }
});

test("daily board is readable by everyone and editable by owners and managers only", { skip: !base }, async () => {
  const f = fixture();
  try {
    const owner = await f.seed();
    const manager = await f.seed("MANAGER", owner.organizationId);
    const worker = await f.seed("WORKER", owner.organizationId);
    const agronomist = await f.seed("AGRONOMIST", owner.organizationId);
    const outsider = await f.seed();
    const body = { headline: "Spray day", items: [{ text: "Spray tomatoes", done: false }] };
    assert.equal((await request("/board", "PUT", body, worker.cookie)).status, 403);
    assert.equal((await request("/board", "PUT", body, agronomist.cookie)).status, 403);
    assert.equal((await request("/board", "PUT", body, manager.cookie)).status, 200);
    for (const user of [owner, worker, agronomist]) {
      const read = await request("/board", "GET", undefined, user.cookie);
      assert.equal(read.status, 200);
      assert.equal(read.body.data.headline, "Spray day");
    }
    assert.notEqual((await request("/board", "GET", undefined, outsider.cookie)).body.data?.headline, "Spray day");
  } finally { await f.cleanup(); }
});

test("custom livestock types are accepted and workers can count and use stock but not add it", { skip: !base }, async () => {
  const f = fixture();
  try {
    const owner = await f.seed();
    const worker = await f.seed("WORKER", owner.organizationId);
    const farm = (await request("/farms", "POST", { name: "Test farm" }, owner.cookie)).body.data;
    const animal = await request("/livestock", "POST", { farmId: farm.id, species: "Guinea pig", identifier: "GP-1" }, owner.cookie);
    assert.equal(animal.status, 201);
    assert.equal(animal.body.data.species, "GUINEA_PIG");

    const item = await request("/inventory/items", "POST", { name: "Maize seed", category: "SEED", unit: "kg", trackingMode: "BATCH" }, owner.cookie);
    assert.equal(item.status, 201);
    assert.equal((await request("/inventory/items", "POST", { name: "Nope", category: "SEED", unit: "kg" }, worker.cookie)).status, 403);
    const move = `/inventory/items/${item.body.data.id}/movements`;
    assert.equal((await request(move, "POST", { type: "IN", quantity: 10 }, owner.cookie)).status, 201);
    assert.equal((await request(move, "POST", { type: "IN", quantity: 5 }, worker.cookie)).status, 403);
    assert.equal((await request(move, "POST", { type: "OUT", quantity: 2, notes: "Planted" }, worker.cookie)).status, 201);
    assert.equal((await request(move, "POST", { type: "ADJUSTMENT", quantity: 7, notes: "Recount" }, worker.cookie)).status, 201);
  } finally { await f.cleanup(); }
});
