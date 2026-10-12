import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../client/js/api.js";
import { offlineStore } from "../client/js/offline.js";
import { itemSchema, movementSchema, assetEventSchema } from "../server/src/modules/inventory/inventory.validation.js";

test("inventory quantities are bounded and precise, including hybrid asset validation", () => {
  for (const quantity of [0, 0.001, 1.125, 1000000000, "0.3"]) assert.equal(itemSchema.safeParse({ name: "Maize", unit: "kg", category: "SEED", quantity }).success, true);
  for (const quantity of [-1, 0.0001, Infinity, "", " ", null, 1000000001]) assert.equal(itemSchema.safeParse({ name: "Maize", unit: "kg", category: "SEED", quantity }).success, false);
  assert.equal(movementSchema.safeParse({ type: "IN", quantity: 1, unitCost: 1.001 }).success, false);
  assert.equal(movementSchema.safeParse({ type: "ADJUSTMENT", quantity: 0, notes: "Empty store" }).success, true);
  assert.equal(itemSchema.safeParse({ name: "Hoes", unit: "tools", category: "ASSET", quantity: 10 }).data.trackingMode, "BATCH");
  assert.equal(assetEventSchema.safeParse({ requestId: crypto.randomUUID(), type: "MAINTENANCE", condition: "WORKING", notes: "Changed oil", observedAt: "2026-10-12T10:00:00Z", nextMaintenanceDate: "2026-10-11T10:00:00Z" }).success, false);
});

test("disconnected inventory writes never queue a stock change or maintenance event", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  });
  const enqueue = t.mock.method(offlineStore, "enqueue", async () => {});
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Disconnected"); });
  for (const path of ["/inventory/items", "/inventory/items/id/movements", "/inventory/items/id/asset-events", "/inventory/items?id=test"]) await assert.rejects(api.post(path, { quantity: 1 }), /Reconnect/);
  await assert.rejects(api.patch("/inventory/items/id", { name: "Changed" }), /Reconnect/);
  await assert.rejects(api.delete("/inventory/items/id"), /Reconnect/);
  assert.equal(enqueue.mock.callCount(), 0);
});
