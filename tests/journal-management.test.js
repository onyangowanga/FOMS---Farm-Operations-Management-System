import test from "node:test";
import assert from "node:assert/strict";
import { base, fixture, request } from "./helpers.js";
import { prisma } from "../server/src/config/database.js";

test("journal filters, detail and edits retain observations and enforce tenant and worker scope", { skip: !base }, async () => {
  const f = fixture();
  try {
    assert.equal((await request("/journal")).status, 401);
    const owner = await f.seed();
    const worker = await f.seed("WORKER", owner.organizationId);
    const coworker = await f.seed("WORKER", owner.organizationId);
    const outsider = await f.seed();
    const farm = (await request("/farms", "POST", { name: "Journal farm" }, owner.cookie)).body.data;
    const fields = { title: "Rainfall at north field", body: "Light rain after weeding", farmId: farm.id, category: "WEATHER", weather: "Light rain", observedAt: "2026-01-01T09:15:30.500+03:00" };
    const created = await request("/journal", "POST", fields, worker.cookie);
    assert.equal(created.status, 201);
    const path = `/journal/${created.body.data.id}`;
    assert.equal(created.body.data.incidentStatus, null);
    for (const cookie of [coworker.cookie, outsider.cookie]) {
      assert.equal((await request(path, "GET", undefined, cookie)).status, 404);
      assert.equal((await request(path, "PATCH", { body: "Not mine" }, cookie)).status, 404);
    }
    for (const query of [
      `farmId=${farm.id}`, "category=WEATHER", "subjectType=GENERAL", "search=RAIN",
      "from=2026-01-01T00%3A00%3A00Z&to=2026-01-01T23%3A59%3A59Z"
    ]) {
      const result = await request(`/journal?${query}`, "GET", undefined, owner.cookie);
      assert.equal(result.status, 200);
      assert.equal(result.body.meta.total, 1);
      assert.equal(result.body.data[0].id, created.body.data.id);
    }
    assert.equal((await request("/journal?category=ACTIVITY", "GET", undefined, worker.cookie)).body.meta.total, 0);
    assert.equal((await request("/journal?search=rain", "GET", undefined, coworker.cookie)).body.meta.total, 0);
    for (const query of ["page=0", "limit=101", "farmId=bad", "from=bad", "from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z"]) assert.equal((await request(`/journal?${query}`, "GET", undefined, owner.cookie)).status, 400);
    assert.equal((await request(path, "PATCH", undefined, owner.cookie)).status, 400);
    assert.equal((await request(path, "PATCH", { incidentStatus: "RESOLVED" }, owner.cookie)).status, 400);
    assert.equal((await request(path, "PATCH", { body: "Rain stopped" }, worker.cookie)).status, 200);
    const read = await request(path, "GET", undefined, owner.cookie);
    assert.equal(read.body.data.body, "Rain stopped");
    assert.equal(read.body.data.observedAt, "2026-01-01T06:15:30.500Z");
    assert.equal(read.body.data.followUps.length, 0);
    await prisma.farm.update({ where: { id: farm.id }, data: { deletedAt: new Date() } });
    assert.equal((await request(path, "PATCH", { body: "Historical weather note" }, owner.cookie)).status, 200);
    assert.equal((await request(path, "DELETE", undefined, worker.cookie)).status, 200);
    assert.equal((await request(path, "GET", undefined, owner.cookie)).status, 404);
    assert.ok((await prisma.journalEntry.findUnique({ where: { id: created.body.data.id } })).deletedAt);
  } finally { await f.cleanup(); }
});
