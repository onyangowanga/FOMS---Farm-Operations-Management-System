import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../client/js/api.js";
import { offlineStore } from "../client/js/offline.js";

test("disconnected incident follow-ups never queue a false resolution while ordinary journal edits retain offline support", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  });
  const enqueue = t.mock.method(offlineStore, "enqueue", async () => {});
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Disconnected"); });
  for (const path of ["/journal/id/follow-ups", "/journal/id/follow-ups?source=detail"]) await assert.rejects(api.post(path, { incidentStatus: "RESOLVED" }), /Reconnect/);
  assert.equal(enqueue.mock.callCount(), 0);
  assert.equal((await api.patch("/journal/id", { body: "Updated description" })).queued, true);
  assert.equal(enqueue.mock.callCount(), 1);
});
