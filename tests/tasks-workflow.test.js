import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { base, fixture, request } from "./helpers.js";
import { prisma } from "../server/src/config/database.js";
import { taskInputSchema, taskStatusSchema } from "../server/src/modules/tasks/task.validation.js";

test("task schemas reject workflow bypasses, unsafe links and malformed evidence settings", () => {
  for (const payload of [{ title: "Test", status: "APPROVED" }, { title: "Test", evidenceRequired: "false" }, { title: "Test", assignedTo: "not-a-user" }]) assert.equal(taskInputSchema.safeParse(payload).success, false);
  assert.equal(taskStatusSchema.safeParse({ status: "COMPLETED", evidenceUrl: "javascript:alert(1)" }).success, false);
  assert.equal(taskStatusSchema.safeParse({ status: "COMPLETED", evidenceUrl: "https://example.test/evidence" }).success, true);
});
test("additive task migration preserves legacy statuses, dates and evidence without fabricated history", { skip: !base }, async () => {
  assert.ok(["localhost", "127.0.0.1", "app"].includes(new URL(base).hostname));
  const schema = `v05_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const rollback = new Error("Rollback isolated task migration test");
  const sql = await readFile(new URL("../server/prisma/migrations/20261012110000_v05_tasks/migration.sql", import.meta.url), "utf8");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe(`CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'APPROVED')`);
      await tx.$executeRawUnsafe('CREATE TABLE "Organization" ("id" UUID PRIMARY KEY)');
      await tx.$executeRawUnsafe('CREATE TABLE "User" ("id" UUID PRIMARY KEY)');
      await tx.$executeRawUnsafe('CREATE TABLE "Task" ("id" UUID PRIMARY KEY, "status" "TaskStatus" NOT NULL, "completedAt" TIMESTAMP(3), "evidenceUrl" TEXT)');
      await tx.$executeRawUnsafe(`INSERT INTO "Task" VALUES ('00000000-0000-0000-0000-000000000001','PENDING',NULL,NULL),('00000000-0000-0000-0000-000000000002','COMPLETED','2025-01-01','https://example.test/legacy'),('00000000-0000-0000-0000-000000000003','APPROVED','2025-02-01',NULL)`);
      for (const statement of sql.split(";").filter((value) => value.trim())) await tx.$executeRawUnsafe(statement);
      const records = await tx.$queryRawUnsafe('SELECT * FROM "Task" ORDER BY "id"');
      assert.deepEqual(records.map((item) => [item.status, item.evidenceRequired, item.approvedAt, item.approvedBy]), [["PENDING", false, null, null], ["COMPLETED", false, null, null], ["APPROVED", false, null, null]]);
      assert.equal(records[1].completedAt.toISOString(), "2025-01-01T00:00:00.000Z");
      assert.equal(records[1].evidenceUrl, "https://example.test/legacy");
      for (const table of ["TaskEvent", "TaskEvidence", "Notification"]) assert.equal((await tx.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM "${table}"`))[0].count, 0n);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await prisma.$disconnect(); }
});
test("task creation, assignment, submission, rework and approval preserve workflow and tenant permissions", { skip: !base }, async () => {
  const f = fixture();
  try {
    assert.equal((await request("/tasks")).status, 401);
    const owner = await f.seed();
    const manager = await f.seed("MANAGER", owner.organizationId);
    const worker = await f.seed("WORKER", owner.organizationId);
    const otherWorker = await f.seed("WORKER", owner.organizationId);
    const agronomist = await f.seed("AGRONOMIST", owner.organizationId);
    const outsider = await f.seed();
    const foreignFarm = (await request("/farms", "POST", { name: "Foreign farm" }, outsider.cookie)).body.data;
    assert.equal((await request("/tasks", "POST", { title: "No bypass", status: "APPROVED" }, owner.cookie)).status, 400);
    assert.equal((await request("/tasks", "POST", { title: "Foreign assignee", assignedTo: outsider.user.id }, owner.cookie)).status, 400);
    assert.equal((await request("/tasks", "POST", { title: "Foreign farm", farmId: foreignFarm.id }, owner.cookie)).status, 400);
    const create = await request("/tasks", "POST", { title: "Check water", assignedTo: worker.user.id, evidenceRequired: false }, manager.cookie);
    assert.equal(create.status, 201);
    const path = `/tasks/${create.body.data.id}`;
    assert.equal((await request(path, "PATCH", undefined, owner.cookie)).status, 400);
    assert.equal(create.body.data.status, "PENDING");
    assert.equal((await request(path, "GET", undefined, worker.cookie)).body.data.assignee.name, worker.user.name);
    for (const cookie of [otherWorker.cookie, outsider.cookie]) {
      assert.equal((await request(path, "GET", undefined, cookie)).status, 404);
      assert.equal((await request(`${path}/events`, "GET", undefined, cookie)).status, 404);
      assert.equal((await request(`${path}/status`, "POST", { status: "IN_PROGRESS" }, cookie)).status, 404);
    }
    assert.equal((await request(path, "GET", undefined, agronomist.cookie)).status, 200);
    assert.equal((await request(`${path}/status`, "POST", { status: "IN_PROGRESS" }, agronomist.cookie)).status, 403);
    assert.equal((await request(path, "PATCH", { title: "Not allowed" }, worker.cookie)).status, 403);
    assert.equal((await request(`${path}/status`, "POST", { status: "COMPLETED" }, worker.cookie)).status, 409);
    assert.equal((await request(`${path}/status`, "POST", { status: "IN_PROGRESS" }, worker.cookie)).status, 200);
    const submit = await request(`${path}/status`, "POST", { status: "COMPLETED", notes: "Checked supply" }, worker.cookie);
    assert.equal(submit.status, 200);
    assert.ok(submit.body.data.completedAt);
    assert.equal(submit.body.data.submissionNotes, "Checked supply");
    assert.equal((await request(path, "PATCH", { title: "Locked" }, manager.cookie)).status, 409);
    assert.equal((await request(`${path}/status`, "POST", { status: "APPROVED" }, worker.cookie)).status, 403);
    assert.equal((await request(`${path}/status`, "POST", { status: "IN_PROGRESS" }, manager.cookie)).status, 400);
    const rework = await request(`${path}/status`, "POST", { status: "IN_PROGRESS", notes: "Check north trough too" }, manager.cookie);
    assert.equal(rework.status, 200);
    assert.equal(rework.body.data.completedAt, null);
    assert.equal((await request(`${path}/status`, "POST", { status: "COMPLETED", notes: "North checked" }, worker.cookie)).status, 200);
    const approved = await request(`${path}/status`, "POST", { status: "APPROVED", notes: "Verified" }, manager.cookie);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.approvedBy, manager.user.id);
    assert.ok(approved.body.data.approvedAt);
    assert.equal((await request(`${path}/status`, "POST", { status: "IN_PROGRESS" }, owner.cookie)).status, 409);
    const events = (await request(`${path}/events`, "GET", undefined, owner.cookie)).body.data;
    assert.equal(events.length, 6);
    assert.equal(events.find((item) => item.action === "REQUEST_REWORK").notes, "Check north trough too");
    assert.equal((await request(path, "GET", undefined, worker.cookie)).body.data.status, "APPROVED");
    assert.equal((await request(path, "DELETE", undefined, worker.cookie)).status, 403);
    assert.equal((await request(path, "DELETE", undefined, manager.cookie)).status, 200);
    assert.equal((await request(path, "GET", undefined, worker.cookie)).status, 404);
    assert.equal(await prisma.taskEvent.count({ where: { taskId: create.body.data.id } }), 7);
    const unassigned = (await request("/tasks", "POST", { title: "Unassigned" }, owner.cookie)).body.data;
    assert.equal((await request(`/tasks/${unassigned.id}/status`, "POST", { status: "IN_PROGRESS" }, owner.cookie)).status, 200);
    assert.equal((await request(`/tasks/${unassigned.id}/status`, "POST", { status: "COMPLETED" }, owner.cookie)).status, 409);
    assert.equal((await request(`/tasks/${unassigned.id}`, "PATCH", { assignedTo: worker.user.id }, owner.cookie)).body.data.status, "PENDING");
  } finally { await f.cleanup(); }
});
