import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { fixture, request, base } from "./helpers.js";
import { prisma } from "../server/src/config/database.js";

test("inventory: threshold episodes, owner/manager inbox, role changes, tenant scope and archive", { skip: !base }, async () => {
  const f = fixture();
  try {
    const owner = await f.seed();
    const manager = await f.seed("MANAGER", owner.organizationId);
    const agronomist = await f.seed("AGRONOMIST", owner.organizationId);
    const worker = await f.seed("WORKER", owner.organizationId);
    const foreign = await f.seed();
    assert.equal((await request("/notifications")).status, 401);
    const created = await request("/inventory/items", "POST", { name: "Feed bags", category: "FEED", unit: "bags", quantity: 3, reorderLevel: 2 }, owner.cookie);
    assert.equal(created.status, 201);
    const id = created.body.data.id;
    const move = (type, quantity) => request(`/inventory/items/${id}/movements`, "POST", { type, quantity, requestId: crypto.randomUUID() }, owner.cookie);
    assert.equal(await prisma.notification.count({ where: { inventoryItemId: id } }), 0);
    assert.equal((await move("OUT", 1)).status, 201);
    assert.equal(await prisma.notification.count({ where: { inventoryItemId: id } }), 2);
    assert.equal((await move("OUT", 1)).status, 201);
    assert.equal(await prisma.notification.count({ where: { inventoryItemId: id } }), 2);
    const inbox = (await request("/notifications", "GET", undefined, manager.cookie)).body;
    assert.equal(inbox.meta.unread, 1);
    const alert = inbox.data[0];
    assert.equal(alert.inventoryItemId, id);
    assert.equal(alert.taskId, null);
    for (const actor of [agronomist, worker, foreign]) {
      assert.equal((await request("/notifications", "GET", undefined, actor.cookie)).body.meta.unread, 0);
      assert.equal((await request(`/notifications/${alert.id}`, "PATCH", { read: true }, actor.cookie)).status, 404);
    }
    assert.equal((await request(`/notifications/${alert.id}`, "PATCH", { read: true }, manager.cookie)).status, 200);
    assert.equal((await request("/notifications", "GET", undefined, manager.cookie)).body.meta.unread, 0);
    assert.equal((await move("IN", 1)).status, 201);
    assert.equal(await prisma.notification.count({ where: { inventoryItemId: id } }), 2, "Equality does not rearm the low-stock episode");
    assert.equal((await move("IN", 1)).status, 201);
    assert.equal((await move("OUT", 1)).status, 201);
    assert.equal(await prisma.notification.count({ where: { inventoryItemId: id } }), 4);
    assert.equal((await request("/inventory?lowStock=true", "GET", undefined, owner.cookie)).body.data[0].id, id);
    assert.equal((await request("/dashboard", "GET", undefined, owner.cookie)).body.data.lowStockItems, 1);
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: owner.organizationId, userId: manager.user.id } }, data: { role: "AGRONOMIST" } });
    assert.equal((await request("/notifications", "GET", undefined, manager.cookie)).body.meta.total, 0, "Demoted managers lose inventory alerts");
    assert.equal((await request("/notifications/read-all", "POST", {}, owner.cookie)).status, 200);
    assert.equal((await request("/notifications", "GET", undefined, owner.cookie)).body.meta.unread, 0);
    assert.equal((await request(`/inventory/items/${id}/movements`, "POST", { type: "ADJUSTMENT", quantity: 0, notes: "Empty store", requestId: crypto.randomUUID() }, owner.cookie)).status, 201);
    assert.equal((await request(`/inventory/items/${id}`, "DELETE", undefined, owner.cookie)).status, 200);
    assert.equal((await request("/notifications", "GET", undefined, owner.cookie)).body.meta.total, 0);
    const low = await request("/inventory/items", "POST", { name: "Initially low seeds", category: "SEED", unit: "kg", quantity: 0 }, owner.cookie);
    assert.equal(low.status, 201);
    assert.equal(await prisma.notification.count({ where: { inventoryItemId: low.body.data.id } }), 1);
  } finally { await f.cleanup(); }
});
