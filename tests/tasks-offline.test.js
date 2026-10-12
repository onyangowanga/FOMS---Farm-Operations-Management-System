import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../client/js/api.js";
import { offlineStore } from "../client/js/offline.js";

function navigatorForTest(t, onLine) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  });
}

test("notification query endpoints never cache or reuse an offline inbox", async (t) => {
  navigatorForTest(t, true);
  const put = t.mock.method(offlineStore, "put", async () => {});
  const get = t.mock.method(offlineStore, "get", async () => ({ data: [] }));
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ success: true, data: [], meta: { unread: 0 } })));
  await api.get("/notifications?limit=1");
  await api.get("/notifications?limit=100&page=1");
  assert.equal(put.mock.callCount(), 0);
  navigator.onLine = false;
  await assert.rejects(api.get("/notifications?limit=1"), /Reconnect/);
  await assert.rejects(api.get("/notifications?limit=100&page=1"), /Reconnect/);
  assert.equal(get.mock.callCount(), 0);
  assert.deepEqual(await api.get("/farms?limit=1"), { data: [] });
  assert.equal(get.mock.callCount(), 1);
});

test("disconnected task workflow, evidence and inbox actions never enter the outbox", async (t) => {
  navigatorForTest(t, false);
  const enqueue = t.mock.method(offlineStore, "enqueue", async () => {});
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Network unavailable"); });
  for (const action of [
    () => api.post("/tasks", { title: "Offline task" }),
    () => api.post("/tasks?source=quick-add", { title: "Offline task" }),
    () => api.post("/tasks/id/status", { status: "COMPLETED" }),
    () => api.upload("/tasks/id/evidence", new FormData()),
    () => api.patch("/notifications/id", { read: true }),
    () => api.post("/notifications/read-all", {})
  ]) await assert.rejects(action(), /Reconnect/);
  assert.equal(enqueue.mock.callCount(), 0);
});
