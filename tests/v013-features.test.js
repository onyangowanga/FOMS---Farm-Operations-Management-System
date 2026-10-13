import test from "node:test";
import assert from "node:assert/strict";
import { base, fixture, request } from "./helpers.js";

const inDays = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

test("blocks expose bed details and crops cannot use more beds than the block has", { skip: !base }, async () => {
  const f = fixture();
  try {
    const owner = await f.seed();
    const farm = (await request("/farms", "POST", { name: "Bed farm" }, owner.cookie)).body.data;
    const block = (await request("/blocks", "POST", { farmId: farm.id, name: "Block A", widthMeters: 12.5, bedCount: 20, driplineCount: 2 }, owner.cookie)).body.data;
    assert.equal(block.bedCount, 20);
    const first = await request("/crops", "POST", { farmId: farm.id, blockId: block.id, cropName: "Tomatoes", bedCount: 12 }, owner.cookie);
    assert.equal(first.status, 201);
    assert.equal(first.body.data.bedCount, 12);
    assert.equal((await request("/crops", "POST", { farmId: farm.id, blockId: block.id, cropName: "Onions", bedCount: 9 }, owner.cookie)).status, 409);
    const second = await request("/crops", "POST", { farmId: farm.id, blockId: block.id, cropName: "Onions", bedCount: 8 }, owner.cookie);
    assert.equal(second.status, 201);
    assert.equal((await request(`/crops/${second.body.data.id}`, "PATCH", { bedCount: 9 }, owner.cookie)).status, 409);
    assert.equal((await request(`/blocks/${block.id}`, "PATCH", { bedCount: 19 }, owner.cookie)).status, 409);
    assert.equal((await request(`/blocks/${block.id}`, "PATCH", { bedCount: 25 }, owner.cookie)).status, 200);
    const organization = (await request("/organization", "GET", undefined, owner.cookie)).body.data;
    const saved = organization.farms.find((item) => item.id === farm.id).blocks[0];
    assert.equal(Number(saved.widthMeters), 12.5);
    assert.equal(saved.bedCount, 25);
    assert.equal(saved.driplineCount, 2);
    assert.equal(saved.bedsInUse, 20);
    assert.equal(saved.activeCrops.length, 2);
  } finally { await f.cleanup(); }
});

test("managers request agronomist visits and agronomists complete them with a next visit date", { skip: !base }, async () => {
  const f = fixture();
  try {
    const owner = await f.seed();
    const manager = await f.seed("MANAGER", owner.organizationId);
    const agronomist = await f.seed("AGRONOMIST", owner.organizationId);
    const otherAgronomist = await f.seed("AGRONOMIST", owner.organizationId);
    const worker = await f.seed("WORKER", owner.organizationId);
    const farm = (await request("/farms", "POST", { name: "Visit farm" }, owner.cookie)).body.data;

    assert.equal((await request("/visits", "GET", undefined, worker.cookie)).status, 403);
    const agronomists = (await request("/visits/agronomists", "GET", undefined, manager.cookie)).body.data;
    assert.ok(agronomists.some((item) => item.id === agronomist.user.id));
    assert.equal((await request("/visits", "POST", { scheduledFor: inDays(3), farmId: farm.id }, manager.cookie)).status, 400);
    assert.equal((await request("/visits", "POST", { scheduledFor: inDays(3), agronomistId: worker.user.id }, manager.cookie)).status, 400);

    const requested = await request("/visits", "POST", { scheduledFor: inDays(3), farmId: farm.id, purpose: "Check blight", agronomistId: agronomist.user.id }, manager.cookie);
    assert.equal(requested.status, 201);
    assert.equal(requested.body.data.status, "REQUESTED");
    const visitId = requested.body.data.id;
    const inbox = (await request("/notifications", "GET", undefined, agronomist.cookie)).body.data;
    assert.ok(inbox.some((item) => item.visitId === visitId && item.type === "VISIT_REQUESTED"));

    assert.equal((await request(`/visits/${visitId}/complete`, "POST", { findings: "Done", nextVisitDate: inDays(7) }, otherAgronomist.cookie)).status, 404);
    assert.equal((await request(`/visits/${visitId}/complete`, "POST", { findings: "Done", nextVisitDate: inDays(7) }, manager.cookie)).status, 403);
    assert.equal((await request(`/visits/${visitId}/complete`, "POST", { findings: "Done", nextVisitDate: inDays(-2) }, agronomist.cookie)).status, 400);
    const done = await request(`/visits/${visitId}/complete`, "POST", { findings: "Early blight on block A, spray advised", nextVisitDate: inDays(7) }, agronomist.cookie);
    assert.equal(done.status, 200);
    assert.equal(done.body.data.completed.status, "COMPLETED");
    assert.equal(done.body.data.next.status, "SCHEDULED");
    assert.equal(done.body.data.next.farmId, farm.id);
    assert.equal((await request(`/visits/${visitId}/cancel`, "POST", { reason: "Too late" }, manager.cookie)).status, 409);

    const managerInbox = (await request("/notifications", "GET", undefined, manager.cookie)).body.data;
    assert.ok(managerInbox.some((item) => item.visitId === visitId && item.type === "VISIT_COMPLETED"));
    const open = (await request("/visits?status=OPEN", "GET", undefined, owner.cookie)).body;
    assert.equal(open.meta.next.id, done.body.data.next.id);
    const closed = (await request("/visits?status=CLOSED", "GET", undefined, agronomist.cookie)).body.data;
    assert.deepEqual(closed.map((item) => item.id), [visitId]);
    assert.equal((await request("/visits", "GET", undefined, otherAgronomist.cookie)).body.data.length, 0);

    const cancelled = await request(`/visits/${done.body.data.next.id}/cancel`, "POST", { reason: "Rain day" }, agronomist.cookie);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.status, "CANCELLED");
  } finally { await f.cleanup(); }
});
