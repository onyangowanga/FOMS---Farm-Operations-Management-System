import test from "node:test";
import assert from "node:assert/strict";
import { fixture, request, base } from "./helpers.js";
import { prisma } from "../server/src/config/database.js";
import { reportingFixture, query } from "./reporting.helpers.js";

test("reporting: period operations, crop-only agronomist scope, farm/tenant permissions and live readback", { skip: !base }, async () => {
  const f = fixture();
  try {
    const owner = await f.seed(), manager = await f.seed("MANAGER", owner.organizationId);
    const agronomist = await f.seed("AGRONOMIST", owner.organizationId), worker = await f.seed("WORKER", owner.organizationId), foreign = await f.seed();
    const { farm, crop } = await reportingFixture(owner);
    const path = `/reporting/operations?${query}&farmId=${farm.id}`;
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, "GET", undefined, worker.cookie)).status, 403);
    assert.equal((await request(path, "GET", undefined, foreign.cookie)).status, 404);
    const result = await request(path, "GET", undefined, manager.cookie);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const report = result.body.data;
    assert.equal(report.from, "2026-01-14T21:00:00.000Z");
    assert.equal(report.to, "2026-01-15T20:59:59.999Z");
    assert.equal(report.metrics.cropActivities, 1);
    assert.equal(report.metrics.observations, 2);
    assert.equal(report.sections.find(s => s.id === "livestockEvents").rows[0][5], 7);
    assert.equal(report.sections.find(s => s.id === "completedTasks").rows.length, 1);
    assert.equal(JSON.stringify(report).includes("9876"), false, "Operational journal costs must not become a financial report");
    const cropOnly = (await request(path, "GET", undefined, agronomist.cookie)).body.data;
    assert.equal(cropOnly.title, "Crop operations report");
    assert.deepEqual(cropOnly.sections.map(s => s.id), ["crops", "stages", "activities", "observations", "followUps"]);
    assert.equal(cropOnly.metrics.observations, 1);
    assert.equal(JSON.stringify(cropOnly).includes("Private general report"), false);
    assert.equal(JSON.stringify(cropOnly).includes("Report birds"), false);
    await prisma.cropCycle.update({ where: { id: crop.id }, data: { status: "HARVESTED" } });
    assert.equal((await request(path, "GET", undefined, owner.cookie)).body.data.sections[0].rows[0][2], "HARVESTED", "Snapshot is explicitly current state");
    await prisma.cropCycle.update({ where: { id: crop.id }, data: { deletedAt: new Date() } });
    assert.equal((await request(path, "GET", undefined, agronomist.cookie)).body.data.metrics.cropActivities, 0);
    assert.equal((await request(`/reporting/operations?${query}&currency=KES`, "GET", undefined, owner.cookie)).status, 400);
    assert.equal((await request("/reporting/operations?period=DAILY&date=2026-02-30", "GET", undefined, owner.cookie)).status, 400);
    assert.equal((await request("/reporting/operations?period=DAILY&date=2026-01-15&unknown=1", "GET", undefined, owner.cookie)).status, 400);
  } finally { await f.cleanup(); }
});
