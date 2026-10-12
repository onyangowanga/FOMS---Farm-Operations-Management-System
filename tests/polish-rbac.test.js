import test from "node:test";
import assert from "node:assert/strict";
import { fixture, base, request } from "./helpers.js";

test("worker API allowlist, assigned task isolation, safe selectors and sanitized dashboard", { skip: !base }, async () => {
  const f = fixture();
  try {
    assert.equal((await request("/tasks")).status, 401);
    const owner = await f.seed();
    const worker = await f.seed("WORKER", owner.organizationId);
    const coworker = await f.seed("WORKER", owner.organizationId);
    const agronomist = await f.seed("AGRONOMIST", owner.organizationId);
    for (const resource of ["/team", "/organization", "/farms", "/blocks", "/crops", "/crops/types", "/livestock", "/inventory", "/sales", "/expenses", "/documents", "/admin/clients"]) {
      assert.equal((await request(resource, "GET", undefined, worker.cookie)).status, 403, resource);
    }
    assert.equal((await request("/team", "GET", undefined, agronomist.cookie)).status, 403);
    const assigned = (await request("/tasks", "POST", { title: "Check irrigation", assignedTo: worker.user.id }, owner.cookie)).body.data;
    const other = (await request("/tasks", "POST", { title: "Repair fencing", assignedTo: coworker.user.id }, owner.cookie)).body.data;
    assert.equal((await request("/tasks", "POST", { title: "Unauthorized task" }, worker.cookie)).status, 403);
    const list = (await request("/tasks", "GET", undefined, worker.cookie)).body.data;
    assert.deepEqual(list.map((item) => item.id), [assigned.id]);
    assert.equal((await request(`/tasks/${other.id}`, "PATCH", { status: "COMPLETED" }, worker.cookie)).status, 404);
    assert.equal((await request(`/tasks/${assigned.id}`, "PATCH", { status: "APPROVED" }, worker.cookie)).status, 403);
    assert.equal((await request(`/tasks/${assigned.id}`, "PATCH", { title: "Changed title", status: "IN_PROGRESS" }, worker.cookie)).status, 403);
    assert.equal((await request(`/tasks/${assigned.id}`, "DELETE", undefined, worker.cookie)).status, 403);
    assert.equal((await request(`/tasks/${assigned.id}`, "PATCH", { status: "IN_PROGRESS" }, worker.cookie)).status, 200);
    assert.equal((await request(`/tasks/${assigned.id}`, "PATCH", { status: "COMPLETED" }, worker.cookie)).status, 200);
    assert.equal((await request("/tasks", "GET", undefined, worker.cookie)).body.data[0].status, "COMPLETED");
    const dashboard = (await request("/dashboard", "GET", undefined, worker.cookie)).body.data;
    assert.deepEqual(Object.keys(dashboard).sort(), ["reportCount", "tasks"]);
    assert.equal(dashboard.tasks.completed, 1);
    assert.equal(dashboard.tasks.pending, 0);
    assert.equal((await request("/auth/me", "GET", undefined, worker.cookie)).status, 200);
  } finally { await f.cleanup(); }
});
