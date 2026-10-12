import test from "node:test";
import assert from "node:assert/strict";
import { base, fixture, request } from "./helpers.js";

test("assignment, submission, rework and approval notifications are recipient-scoped and replay-safe", { skip: !base }, async () => {
  const f = fixture();
  try {
    assert.equal((await request("/notifications")).status, 401);
    const owner = await f.seed();
    const manager = await f.seed("MANAGER", owner.organizationId);
    const worker = await f.seed("WORKER", owner.organizationId);
    const coworker = await f.seed("WORKER", owner.organizationId);
    const outsider = await f.seed();
    const task = (await request("/tasks", "POST", { title: "Collect feed", assignedTo: worker.user.id }, owner.cookie)).body.data;
    const path = `/tasks/${task.id}`;
    let inbox = await request("/notifications", "GET", undefined, worker.cookie);
    assert.equal(inbox.body.meta.unread, 1);
    const notification = inbox.body.data[0];
    assert.equal(notification.type, "TASK_ASSIGNED");
    for (const cookie of [owner.cookie, coworker.cookie, outsider.cookie]) {
      assert.equal((await request(`/notifications/${notification.id}`, "PATCH", { read: true }, cookie)).status, 404);
      assert.equal((await request("/notifications", "GET", undefined, cookie)).body.meta.unread, 0);
    }
    assert.equal((await request(`/notifications/${notification.id}`, "PATCH", { read: true }, worker.cookie)).status, 200);
    assert.equal((await request("/notifications", "GET", undefined, worker.cookie)).body.meta.unread, 0);
    assert.equal((await request(`${path}/status`, "POST", { status: "IN_PROGRESS" }, worker.cookie)).status, 200);
    assert.equal((await request(`${path}/status`, "POST", { status: "COMPLETED" }, worker.cookie)).status, 200);
    assert.equal((await request(`${path}/status`, "POST", { status: "COMPLETED" }, worker.cookie)).status, 200);
    for (const cookie of [owner.cookie, manager.cookie]) {
      const inbox = (await request("/notifications", "GET", undefined, cookie)).body;
      assert.equal(inbox.meta.unread, 1);
      assert.equal(inbox.data[0].type, "TASK_SUBMITTED");
    }
    assert.equal((await request(`${path}/status`, "POST", { status: "IN_PROGRESS", notes: "Collect remaining bags" }, manager.cookie)).status, 200);
    assert.equal((await request("/notifications", "GET", undefined, worker.cookie)).body.data[0].type, "TASK_REWORK");
    assert.equal((await request(`${path}/status`, "POST", { status: "COMPLETED" }, worker.cookie)).status, 200);
    assert.equal((await request(`${path}/status`, "POST", { status: "APPROVED" }, owner.cookie)).status, 200);
    inbox = (await request("/notifications", "GET", undefined, worker.cookie)).body;
    assert.equal(inbox.data[0].type, "TASK_APPROVED");
    assert.equal(inbox.meta.unread, 2);
    assert.equal((await request("/notifications/read-all", "POST", {}, coworker.cookie)).status, 200);
    assert.equal((await request("/notifications", "GET", undefined, worker.cookie)).body.meta.unread, 2);
    assert.equal((await request("/notifications/read-all", "POST", {}, worker.cookie)).status, 200);
    assert.equal((await request("/notifications", "GET", undefined, worker.cookie)).body.meta.unread, 0);
    const reassigned = (await request("/tasks", "POST", { title: "Move tools", assignedTo: worker.user.id }, owner.cookie)).body.data;
    assert.equal((await request(`/tasks/${reassigned.id}`, "PATCH", { assignedTo: coworker.user.id }, owner.cookie)).status, 200);
    assert.equal((await request(`/tasks/${reassigned.id}`, "GET", undefined, worker.cookie)).status, 404);
    assert.equal((await request("/notifications", "GET", undefined, worker.cookie)).body.data.some((item) => item.taskId === reassigned.id), false);
    assert.equal((await request("/notifications", "GET", undefined, coworker.cookie)).body.meta.unread, 1);
    assert.equal((await request(`/tasks/${reassigned.id}`, "DELETE", undefined, owner.cookie)).status, 200);
    assert.equal((await request("/notifications", "GET", undefined, coworker.cookie)).body.meta.unread, 0);
  } finally { await f.cleanup(); }
});
