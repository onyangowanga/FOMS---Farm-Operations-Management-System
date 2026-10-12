import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { rmdir } from "node:fs/promises";
import { fixture, request, base } from "./helpers.js";
import { prisma } from "../server/src/config/database.js";
import { removeUpload } from "../server/src/shared/uploads.js";
import { png } from "./tasks.helpers.js";

async function upload(id, cookie, bytes = png) {
  const form = new FormData(); form.set("file", new Blob([bytes]), "receipt.png");
  const response = await fetch(`${base}/api/v1/expenses/${id}/attachments`, { method: "POST", headers: { Cookie: cookie }, body: form });
  return { status: response.status, body: await response.json() };
}
test("finance: expense workflow, private receipts, owner approval, replay and immutable approved records", { skip: !base }, async () => {
  const f = fixture();
  try {
    const owner = await f.seed();
    const manager = await f.seed("MANAGER", owner.organizationId);
    const agronomist = await f.seed("AGRONOMIST", owner.organizationId);
    const foreign = await f.seed();
    assert.equal((await request("/expenses")).status, 401);
    const payload = { description: "Seeds purchase", category: "SEED", amount: 25.15, requestId: crypto.randomUUID() };
    const created = await request("/expenses", "POST", payload, manager.cookie);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.id;
    const url = `/expenses/${id}`;
    assert.equal(created.body.data.amount, 25.15);
    assert.equal(created.body.data.approvedAt, null);
    assert.equal((await request("/expenses", "POST", payload, manager.cookie)).body.data.id, id);
    assert.equal((await request("/expenses", "POST", { ...payload, amount: 25 }, manager.cookie)).status, 409);
    assert.equal((await request(url, "GET", undefined, foreign.cookie)).status, 404);
    assert.equal((await request(url, "GET", undefined, agronomist.cookie)).status, 403);
    assert.equal((await request(`${url}/approve`, "POST", {}, manager.cookie)).status, 403);
    for (const amount of [0, -1, 0.001, "", null, 10000000000]) assert.equal((await request(url, "PATCH", { amount }, owner.cookie)).status, 400);
    assert.equal((await request(url, "PATCH", { amount: 30.25, supplier: "Seed supplier" }, manager.cookie)).status, 200);
    assert.equal((await upload(id, "", png)).status, 401);
    assert.equal((await upload(id, foreign.cookie)).status, 404);
    assert.equal((await upload(id, agronomist.cookie)).status, 403);
    assert.equal((await upload(id, owner.cookie, Buffer.from("not a file"))).status, 415);
    const file = await upload(id, manager.cookie);
    assert.equal(file.status, 201);
    assert.equal(Object.hasOwn(file.body.data, "storageName"), false);
    const download = `${base}${file.body.data.downloadPath}`;
    for (const [actor, status] of [[owner, 200], [manager, 200], [foreign, 404], [agronomist, 403]]) {
      const response = await fetch(download, { headers: { Cookie: actor.cookie } });
      assert.equal(response.status, status);
      if (status === 200) assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    }
    assert.equal((await request(`${url}/approve`, "POST", {}, owner.cookie)).status, 200);
    assert.equal((await request(`${url}/approve`, "POST", {}, owner.cookie)).status, 200);
    assert.equal(await prisma.auditLog.count({ where: { entityId: id, action: "APPROVE" } }), 1);
    assert.equal((await request(url, "PATCH", { amount: 99 }, owner.cookie)).status, 409);
    assert.equal((await request(url, "DELETE", undefined, owner.cookie)).status, 409);
    assert.equal((await upload(id, owner.cookie)).status, 409);
    assert.equal((await request(`${url}/attachments/${file.body.data.id}`, "DELETE", undefined, owner.cookie)).status, 409);
    assert.equal((await request(url, "GET", undefined, owner.cookie)).body.data.amount, 30.25);
    const pending = await request("/expenses", "POST", { ...payload, requestId: crypto.randomUUID() }, manager.cookie);
    const pendingId = pending.body.data.id;
    const removed = await upload(pendingId, manager.cookie);
    assert.equal((await request(`/expenses/${pendingId}/attachments/${removed.body.data.id}`, "DELETE", undefined, owner.cookie)).status, 200);
    assert.equal((await fetch(`${base}${removed.body.data.downloadPath}`, { headers: { Cookie: owner.cookie } })).status, 404);
    assert.equal((await request(`/expenses/${pendingId}`, "DELETE", undefined, manager.cookie)).status, 200);
    assert.equal((await request(`/expenses/${pendingId}`, "GET", undefined, owner.cookie)).status, 404);
    assert.equal(await prisma.expenseAttachment.count({ where: { expenseId: pendingId } }), 1);
    assert.equal((await request("/expenses?approval=APPROVED", "GET", undefined, owner.cookie)).body.meta.total, 1);
  } finally {
    const files = await prisma.expenseAttachment.findMany({ where: { organizationId: { in: f.organizations } } });
    for (const file of files) await removeUpload(path.resolve("uploads", file.storageName));
    for (const id of new Set(files.map((file) => file.organizationId))) {
      try { await rmdir(path.resolve("uploads", id)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    await f.cleanup();
  }
});
