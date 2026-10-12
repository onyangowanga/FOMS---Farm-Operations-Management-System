import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../client/js/api.js";
import { offlineStore } from "../client/js/offline.js";

test("reporting client downloads require connection, preserve refresh retry and expose export errors", async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  t.after(() => { if (original) Object.defineProperty(globalThis, "navigator", original); else delete globalThis.navigator; });
  const cache = t.mock.method(offlineStore, "get", async () => { throw Error("Reports cannot read stale cache"); });
  const put = t.mock.method(offlineStore, "put", async () => { throw Error("Reports cannot populate offline cache"); });
  await assert.rejects(api.get("/reporting/operations?period=DAILY"), /Reconnect/);
  await assert.rejects(api.download("/reporting/financial/pdf"), /Reconnect/);
  assert.equal(cache.mock.callCount(), 0);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  let attempt = 0;
  const fetch = t.mock.method(globalThis, "fetch", async path => {
    if (path === "/api/v1/auth/refresh") return new Response("{}", { status: 200 });
    if (++attempt === 1) return new Response("{}", { status: 401 });
    return new Response("%PDF-fixture", { status: 200, headers: { "Content-Type": "application/pdf" } });
  });
  const downloaded = await api.download("/reporting/operations/pdf");
  assert.ok(downloaded instanceof Blob);
  assert.equal(await downloaded.text(), "%PDF-fixture");
  assert.equal(fetch.mock.callCount(), 3);
  assert.equal(put.mock.callCount(), 0);
  fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ message: "Select a shorter period" }), { status: 413 }));
  await assert.rejects(api.download("/reporting/financial/xlsx"), /Select a shorter period/);
});
