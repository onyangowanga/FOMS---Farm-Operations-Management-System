import test from "node:test";
import assert from "node:assert/strict";
import { api, syncOutbox } from "../client/js/api.js";
import { offlineStore } from "../client/js/offline.js";
import { money, quantity } from "../server/src/modules/finance/finance.shared.js";

test("financial amounts and quantities reject invalid precision rather than silently round", () => {
  for (const value of [0.01, 0.3, 125.5, "125.50", 9999999999.99]) assert.equal(money.safeParse(value).success, true);
  for (const value of [0, -1, 0.001, "", " ", null, Infinity, 10000000000]) assert.equal(money.safeParse(value).success, false);
  assert.equal(quantity.safeParse(0.001).success, true);
  assert.equal(quantity.safeParse(0.0001).success, false);
});
test("financial writes and reads require connection; legacy financial outbox operations need review", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  });
  const enqueue = t.mock.method(offlineStore, "enqueue", async () => {});
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Disconnected"); });
  for (const path of ["/expenses", "/expenses/id/approve", "/sales", "/sales/id/payments"]) await assert.rejects(api.post(path, {}), /Reconnect/);
  await assert.rejects(api.patch("/expenses/id", {}), /Reconnect/);
  await assert.rejects(api.delete("/sales/id"), /Reconnect/);
  for (const path of ["/finance", "/sales", "/expenses/id"]) await assert.rejects(api.get(path), /Reconnect/);
  assert.equal(enqueue.mock.callCount(), 0);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  t.mock.method(offlineStore, "pending", async () => [{ id: 1, identity: "org:user", path: "/expenses", method: "POST", body: "{}" }]);
  const before = fetch.mock.callCount();
  await assert.rejects(syncOutbox({ organizationId: "org", userId: "user" }), /awaiting review/);
  assert.equal(fetch.mock.callCount(), before);
});
