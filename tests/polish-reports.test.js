import test from "node:test";
import assert from "node:assert/strict";
import { base, fixture, request } from "./helpers.js";
import { localDateTime } from "../client/js/reports.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVYkAAAAASUVORK5CYII=", "base64");
async function submitReport(payload, photo, cookie) {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) form.set(key, value);
  if (photo) form.set("photo", new Blob([photo], { type: "image/png" }), "observation.png");
  const response = await fetch(`${base}/api/v1/journal`, { method: "POST", headers: { Cookie: cookie }, body: form });
  return { status: response.status, body: await response.json() };
}
test("report form date/time is local and defaults to the current minute", () => {
  const date = new Date();
  const value = localDateTime(date);
  const parsed = new Date(value);
  assert.ok(Math.abs(date - parsed) < 60000);
  assert.match(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
});
test("daily reports persist crop/livestock associations, timestamps and private photo ownership", { skip: !base }, async () => {
  const f = fixture();
  try {
    assert.equal((await request("/journal")).status, 401);
    const owner = await f.seed();
    const worker = await f.seed("WORKER", owner.organizationId);
    const coworker = await f.seed("WORKER", owner.organizationId);
    const outsider = await f.seed();
    const farm = (await request("/farms", "POST", { name: "Reporting farm" }, owner.cookie)).body.data;
    const secondFarm = (await request("/farms", "POST", { name: "Different farm" }, owner.cookie)).body.data;
    const crop = (await request("/crops", "POST", { farmId: farm.id, cropName: "Onions" }, owner.cookie)).body.data;
    const livestock = (await request("/livestock", "POST", { farmId: farm.id, species: "GOAT", identifier: "Doe A" }, owner.cookie)).body.data;
    const selectors = (await request("/journal/selectors", "GET", undefined, worker.cookie)).body.data;
    assert.equal(selectors.crops.find((item) => item.id === crop.id).cropName, "Onions");
    assert.ok(!Object.hasOwn(selectors.crops[0], "expectedYield"));
    assert.equal((await request("/journal/selectors", "GET", undefined, outsider.cookie)).body.data.crops.length, 0);
    const payload = { farmId: farm.id, cropId: crop.id, subjectType: "CROP", title: "Onion observation", body: "Leaves look healthy", observedAt: "2026-01-01T09:30:00+03:00" };
    assert.equal((await submitReport(payload, png, "")).status, 401);
    assert.equal((await submitReport(payload, png, outsider.cookie)).status, 400);
    assert.equal((await submitReport({ ...payload, farmId: secondFarm.id }, png, worker.cookie)).status, 400);
    assert.equal((await submitReport({ ...payload, observedAt: "2999-01-01" }, null, worker.cookie)).status, 400);
    assert.equal((await submitReport(payload, Buffer.from("Not an image"), worker.cookie)).status, 415);
    const cropReport = await submitReport(payload, png, worker.cookie);
    assert.equal(cropReport.status, 201);
    assert.equal(cropReport.body.data.observedAt, "2026-01-01T06:30:00.000Z");
    assert.equal(cropReport.body.data.crop.cropName, "Onions");
    assert.ok(!Object.hasOwn(cropReport.body.data, "photoStorageName"));
    const detail = await request(`/journal/${cropReport.body.data.id}`, "GET", undefined, worker.cookie);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.crop.id, crop.id);
    assert.equal(detail.body.data.photoPath, cropReport.body.data.photoPath);
    assert.equal((await request(`/journal?cropId=${crop.id}`, "GET", undefined, owner.cookie)).body.meta.total, 1);
    const photoUrl = `${base}${cropReport.body.data.photoPath}`;
    for (const [cookie, status] of [["", 401], [worker.cookie, 200], [owner.cookie, 200], [coworker.cookie, 404], [outsider.cookie, 404]]) {
      const response = await fetch(photoUrl, { headers: { Cookie: cookie } });
      assert.equal(response.status, status);
      if (status === 200) assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    }
    const animalReport = await submitReport({ farmId: farm.id, livestockId: livestock.id, subjectType: "LIVESTOCK", title: "Goat report", body: "Vaccination check" }, null, worker.cookie);
    assert.equal(animalReport.status, 201);
    assert.ok(Math.abs(Date.now() - new Date(animalReport.body.data.observedAt)) < 10000);
    assert.equal(animalReport.body.data.livestock.identifier, "Doe A");
    assert.equal(animalReport.body.data.photoPath, null);
    assert.equal((await request("/journal", "POST", { title: "General note", body: "Gate repaired" }, owner.cookie)).status, 201);
    const workerRecords = (await request("/journal", "GET", undefined, worker.cookie)).body.data;
    assert.equal(workerRecords.length, 2);
    assert.equal((await request("/journal", "GET", undefined, coworker.cookie)).body.data.length, 0);
    assert.equal((await request("/journal", "GET", undefined, owner.cookie)).body.data.length, 3);
    const path = `/journal/${cropReport.body.data.id}`;
    assert.equal((await request(path, "PATCH", { body: "Unauthorized" }, coworker.cookie)).status, 404);
    const update = await request(path, "PATCH", { body: "Updated crop observation" }, worker.cookie);
    assert.equal(update.status, 200);
    assert.equal(update.body.data.subjectType, "CROP");
    assert.equal(update.body.data.observedAt, "2026-01-01T06:30:00.000Z");
    assert.equal(update.body.data.photoPath, cropReport.body.data.photoPath);
    assert.equal((await request("/journal", "GET", undefined, worker.cookie)).body.data.find((item) => item.id === cropReport.body.data.id).body, "Updated crop observation");
    assert.equal((await request(path, "DELETE", undefined, outsider.cookie)).status, 404);
    assert.equal((await request(path, "DELETE", undefined, worker.cookie)).status, 200);
    assert.equal((await fetch(photoUrl, { headers: { Cookie: worker.cookie } })).status, 404);
  } finally {
    // Files are retained for archived production reports; only remove this isolated test workspace's uploads.
    const { prisma } = await import("../server/src/config/database.js");
    const { removeUpload } = await import("../server/src/shared/uploads.js");
    const { rmdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const files = await prisma.journalEntry.findMany({ where: { organizationId: { in: f.organizations }, photoStorageName: { not: null } }, select: { photoStorageName: true } });
    for (const file of files) await removeUpload(path.resolve("uploads", file.photoStorageName));
    for (const organizationId of new Set(files.map((file) => file.photoStorageName.split("/")[0]))) {
      try { await rmdir(path.resolve("uploads", organizationId)); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    await f.cleanup();
  }
});
