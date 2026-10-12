import test from "node:test";
import assert from "node:assert/strict";
import { base, fixture, request } from "./helpers.js";
import { prisma } from "../server/src/config/database.js";
import { png, uploadEvidence, cleanupTaskEvidence } from "./tasks.helpers.js";

test("task evidence is private, type-verified, required per task and locked after submission", { skip: !base }, async () => {
  const f = fixture();
  try {
    assert.equal((await request("/tasks")).status, 401);
    const owner = await f.seed();
    const worker = await f.seed("WORKER", owner.organizationId);
    const coworker = await f.seed("WORKER", owner.organizationId);
    const outsider = await f.seed();
    const task = (await request("/tasks", "POST", { title: "Repair gate", assignedTo: worker.user.id, evidenceRequired: true }, owner.cookie)).body.data;
    const path = `/tasks/${task.id}`;
    assert.equal((await uploadEvidence(task.id, "")).status, 401);
    assert.equal((await uploadEvidence(task.id, coworker.cookie)).status, 404);
    assert.equal((await uploadEvidence(task.id, outsider.cookie)).status, 404);
    assert.equal((await uploadEvidence(task.id, worker.cookie, Buffer.from("Not an image"), "fake.png")).status, 415);
    assert.equal((await uploadEvidence(task.id, worker.cookie, Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
    assert.equal((await request(`${path}/status`, "POST", { status: "IN_PROGRESS" }, worker.cookie)).status, 200);
    assert.equal((await request(`${path}/status`, "POST", { status: "COMPLETED" }, worker.cookie)).status, 409);
    const image = await uploadEvidence(task.id, worker.cookie, png, "../gate.png");
    assert.equal(image.status, 201);
    assert.equal(image.body.data.originalName, "gate.png");
    assert.equal(image.body.data.mimeType, "image/png");
    assert.equal(Object.hasOwn(image.body.data, "storageName"), false);
    const url = `${base}${image.body.data.downloadPath}`;
    for (const [cookie, status] of [["", 401], [owner.cookie, 200], [worker.cookie, 200], [coworker.cookie, 404], [outsider.cookie, 404]]) {
      const response = await fetch(url, { headers: { Cookie: cookie } });
      assert.equal(response.status, status);
      if (status === 200) {
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      }
    }
    const pdf = await uploadEvidence(task.id, owner.cookie, Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"), "inspection.pdf");
    assert.equal(pdf.status, 201);
    assert.equal(pdf.body.data.mimeType, "application/pdf");
    assert.equal((await request(`${path}/evidence/${pdf.body.data.id}`, "DELETE", undefined, worker.cookie)).status, 404);
    assert.equal((await request(`${path}/evidence/${image.body.data.id}`, "DELETE", undefined, worker.cookie)).status, 200);
    assert.equal((await fetch(url, { headers: { Cookie: worker.cookie } })).status, 404);
    assert.equal((await request(`${path}/evidence/${pdf.body.data.id}`, "DELETE", undefined, owner.cookie)).status, 200);
    assert.equal((await request(`${path}/status`, "POST", { status: "COMPLETED" }, worker.cookie)).status, 409);
    const submitted = await uploadEvidence(task.id, worker.cookie);
    assert.equal(submitted.status, 201);
    assert.equal((await request(`${path}/status`, "POST", { status: "COMPLETED" }, worker.cookie)).status, 200);
    assert.equal((await uploadEvidence(task.id, worker.cookie)).status, 409);
    assert.equal((await request(`${path}/evidence/${submitted.body.data.id}`, "DELETE", undefined, owner.cookie)).status, 409);
    assert.equal((await request(`${path}/evidence`, "GET", undefined, worker.cookie)).body.data.length, 1);
    assert.equal((await request(`${path}/status`, "POST", { status: "APPROVED" }, owner.cookie)).status, 200);
    assert.equal((await request(path, "DELETE", undefined, owner.cookie)).status, 200);
    assert.equal((await fetch(`${base}${submitted.body.data.downloadPath}`, { headers: { Cookie: owner.cookie } })).status, 404);
    assert.equal(await prisma.taskEvidence.count({ where: { taskId: task.id } }), 3);
  } finally { await cleanupTaskEvidence(f); await f.cleanup(); }
});
test("task evidence limit allows ten active files and frees a slot on removal", { skip: !base }, async () => {
  const f = fixture();
  try {
    const owner = await f.seed();
    const worker = await f.seed("WORKER", owner.organizationId);
    const task = (await request("/tasks", "POST", { title: "Photo limit", assignedTo: worker.user.id }, owner.cookie)).body.data;
    let first;
    for (let i = 0; i < 10; i++) {
      const response = await uploadEvidence(task.id, worker.cookie);
      assert.equal(response.status, 201);
      first ||= response.body.data.id;
    }
    assert.equal((await uploadEvidence(task.id, worker.cookie)).status, 409);
    assert.equal((await request(`/tasks/${task.id}/evidence/${first}`, "DELETE", undefined, worker.cookie)).status, 200);
    assert.equal((await uploadEvidence(task.id, worker.cookie)).status, 201);
    assert.equal((await request(`/tasks/${task.id}/evidence`, "GET", undefined, worker.cookie)).body.data.length, 10);
  } finally { await cleanupTaskEvidence(f); await f.cleanup(); }
});
