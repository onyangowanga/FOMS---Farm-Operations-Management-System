import test from "node:test";
import assert from "node:assert/strict";
import { fixture, base, request } from "./helpers.js";

test("workspace user management protects ownership, isolates tenants and revokes removed users", { skip: !base }, async () => {
  const f = fixture();
  try {
    assert.equal((await request("/team")).status, 401);
    const owner = await f.seed();
    const manager = await f.seed("MANAGER", owner.organizationId);
    const outsider = await f.seed();
    const records = (await request("/team", "GET", undefined, owner.cookie)).body.data;
    const ownerId = records.find((member) => member.user.id === owner.user.id).id;
    assert.equal((await request(`/team/${ownerId}`, "PATCH", { role: "WORKER" }, manager.cookie)).status, 403);
    assert.equal((await request(`/team/${ownerId}`, "PATCH", { role: "WORKER" }, owner.cookie)).status, 409);
    const payload = { name: "Staff test", username: `staff-${f.suffix}`, email: `staff-${f.suffix}@example.test`, password: f.password, role: "WORKER" };
    assert.equal((await request("/team", "POST", { ...payload, role: "OWNER" }, manager.cookie)).status, 403);
    const created = await request("/team", "POST", payload, manager.cookie);
    assert.equal(created.status, 201);
    f.users.push(created.body.data.id);
    const workerLogin = await request("/auth/login", "POST", { username: payload.username, password: f.password });
    const member = (await request("/team", "GET", undefined, owner.cookie)).body.data.find((item) => item.user.id === created.body.data.id);
    assert.equal((await request(`/team/${member.id}`, "PATCH", { name: "Cross tenant" }, outsider.cookie)).status, 404);
    assert.equal((await request("/team", "POST", payload, workerLogin.cookie)).status, 403);
    assert.equal((await request(`/team/${member.id}`, "PATCH", { name: "Updated staff", role: "AGRONOMIST" }, manager.cookie)).status, 200);
    assert.equal((await request("/auth/me", "GET", undefined, workerLogin.cookie)).status, 401);
    const worker = (await request("/auth/login", "POST", { username: payload.username, password: f.password })).cookie;
    assert.equal((await request("/auth/me", "GET", undefined, worker)).body.data.user.name, "Updated staff");
    const task = await request("/tasks", "POST", { title: "Assigned task", assignedTo: created.body.data.id }, owner.cookie);
    assert.equal(task.status, 201);
    assert.equal((await request(`/tasks/${task.body.data.id}/status`, "POST", { status: "IN_PROGRESS" }, owner.cookie)).status, 200);
    assert.equal((await request(`/team/${member.id}`, "DELETE", undefined, manager.cookie)).status, 200);
    assert.equal((await request("/auth/me", "GET", undefined, worker)).status, 401);
    assert.equal((await request("/auth/refresh", "POST", {}, worker)).status, 401);
    const tasks = await request("/tasks", "GET", undefined, owner.cookie);
    assert.equal(tasks.body.data.find((item) => item.id === task.body.data.id).assignedTo, null);
    assert.equal(tasks.body.data.find((item) => item.id === task.body.data.id).status, "PENDING");
    const history = (await request(`/tasks/${task.body.data.id}/events`, "GET", undefined, owner.cookie)).body.data;
    assert.equal(history.find((event) => event.action === "REASSIGN").fromStatus, "IN_PROGRESS");
    assert.equal((await request(`/team/${ownerId}`, "DELETE", undefined, owner.cookie)).status, 409);
  } finally { await f.cleanup(); }
});
