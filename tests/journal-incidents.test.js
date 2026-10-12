import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { base, fixture, request } from "./helpers.js";
import { prisma } from "../server/src/config/database.js";

test("journal migration preserves legacy notes and photos without invented severity or follow-ups", { skip: !base }, async () => {
  const schema = `journal_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const rollback = new Error("Rollback isolated journal migration");
  const sql = await readFile(new URL("../server/prisma/migrations/20261012120000_v06_journal/migration.sql", import.meta.url), "utf8");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe('CREATE TABLE "User" ("id" UUID PRIMARY KEY)');
      await tx.$executeRawUnsafe('CREATE TABLE "JournalEntry" ("id" UUID PRIMARY KEY, "category" TEXT, "incident" TEXT, "observedAt" TIMESTAMP(3), "body" TEXT, "photoStorageName" TEXT)');
      await tx.$executeRawUnsafe(`INSERT INTO "JournalEntry" VALUES ('00000000-0000-0000-0000-000000000001','PEST_DISEASE',NULL,'2026-01-01','Leaf spots','legacy/photo.png'),('00000000-0000-0000-0000-000000000002','OBSERVATION','Aphids','2026-01-02','Field note',NULL),('00000000-0000-0000-0000-000000000003','OBSERVATION','  ','2026-01-03','Ordinary note',NULL)`);
      for (const statement of sql.split(";").filter((value) => value.trim())) await tx.$executeRawUnsafe(statement);
      const records = await tx.$queryRawUnsafe('SELECT * FROM "JournalEntry" ORDER BY "id"');
      assert.deepEqual(records.map((item) => item.incidentStatus), ["OPEN", "OPEN", null]);
      assert.ok(records.every((item) => item.incidentSeverity === null));
      assert.equal(records[0].body, "Leaf spots");
      assert.equal(records[0].photoStorageName, "legacy/photo.png");
      assert.equal(records[0].incidentUpdatedAt.getTime(), records[0].observedAt.getTime());
      assert.equal((await tx.$queryRawUnsafe('SELECT COUNT(*) AS count FROM "JournalFollowUp"'))[0].count, 0n);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await prisma.$disconnect(); }
});

test("incident assessment, dated resolution and reopening preserve append-only history and retry safety", { skip: !base }, async () => {
  const f = fixture();
  try {
    assert.equal((await request("/journal")).status, 401);
    const owner = await f.seed();
    const manager = await f.seed("MANAGER", owner.organizationId);
    const agronomist = await f.seed("AGRONOMIST", owner.organizationId);
    const worker = await f.seed("WORKER", owner.organizationId);
    const outsider = await f.seed();
    const initial = { title: "Aphids on leaves", body: "Check the affected crop", category: "PEST_DISEASE", observedAt: "2026-01-01T08:00:00Z" };
    assert.equal((await request("/journal", "POST", { ...initial, incidentSeverity: "HIGH" }, worker.cookie)).status, 403);
    const entry = await request("/journal", "POST", initial, worker.cookie);
    assert.equal(entry.status, 201);
    assert.equal(entry.body.data.incidentStatus, "OPEN");
    assert.equal(entry.body.data.incidentSeverity, null);
    const path = `/journal/${entry.body.data.id}`;
    const followUp = { requestId: crypto.randomUUID(), notes: "Inspected and treated affected plants", observedAt: "2026-01-03T08:00:00Z", incidentStatus: "RESOLVED", incidentSeverity: "LOW" };
    assert.equal((await request(`${path}/follow-ups`, "POST", followUp)).status, 401);
    assert.equal((await request(`${path}/follow-ups`, "POST", followUp, worker.cookie)).status, 403);
    assert.equal((await request(`${path}/follow-ups`, "POST", followUp, outsider.cookie)).status, 404);
    for (const invalid of [
      { ...followUp, requestId: crypto.randomUUID(), observedAt: "2025-01-01" },
      { ...followUp, requestId: crypto.randomUUID(), observedAt: "2999-01-01" },
      { ...followUp, requestId: crypto.randomUUID(), notes: "" }
    ]) assert.equal((await request(`${path}/follow-ups`, "POST", invalid, owner.cookie)).status, 400);
    const saved = await request(`${path}/follow-ups`, "POST", followUp, agronomist.cookie);
    assert.equal(saved.status, 201);
    assert.equal((await request(`${path}/follow-ups`, "POST", followUp, agronomist.cookie)).body.data.id, saved.body.data.id);
    assert.equal((await request(`${path}/follow-ups`, "POST", { ...followUp, notes: "Changed retry" }, agronomist.cookie)).status, 409);
    assert.equal((await request(`${path}/follow-ups`, "POST", followUp, manager.cookie)).status, 409);
    const earlier = { ...followUp, requestId: crypto.randomUUID(), notes: "Earlier initial inspection", observedAt: "2026-01-02T08:00:00Z", incidentStatus: "OPEN", incidentSeverity: "HIGH" };
    assert.equal((await request(`${path}/follow-ups`, "POST", earlier, manager.cookie)).status, 201);
    let read = (await request(path, "GET", undefined, worker.cookie)).body.data;
    assert.equal(read.incidentStatus, "RESOLVED");
    assert.equal(read.incidentSeverity, "LOW");
    assert.equal(read.followUps.length, 2);
    assert.equal(read.followUps[0].notes, followUp.notes);
    assert.equal((await request(path, "PATCH", { category: "OBSERVATION" }, owner.cookie)).status, 409);
    assert.equal((await request(path, "PATCH", { incidentSeverity: "HIGH" }, worker.cookie)).status, 403);
    assert.equal((await request(path, "PATCH", { incidentSeverity: "HIGH" }, owner.cookie)).status, 409);
    assert.equal((await request(path, "PATCH", { observedAt: "2026-01-02" }, owner.cookie)).status, 409);
    assert.equal((await request(path, "PATCH", { body: "Corrected original description" }, worker.cookie)).status, 200);
    assert.equal((await request(`${path}/follow-ups`, "POST", { ...earlier, requestId: crypto.randomUUID(), notes: "Recurrence detected", observedAt: "2026-01-04T08:00:00Z" }, owner.cookie)).status, 201);
    read = (await request(path, "GET", undefined, owner.cookie)).body.data;
    assert.equal(read.incidentStatus, "OPEN");
    assert.equal(read.incidentSeverity, "HIGH");
    assert.equal(read.followUps.length, 3);
    assert.equal((await request("/journal?incidentStatus=OPEN", "GET", undefined, owner.cookie)).body.meta.total, 1);
    const ordinary = (await request("/journal", "POST", { title: "Work done", body: "Weeded today" }, owner.cookie)).body.data;
    assert.equal((await request(`/journal/${ordinary.id}/follow-ups`, "POST", followUp, manager.cookie)).status, 409);
    assert.equal((await request(path, "DELETE", undefined, manager.cookie)).status, 200);
    assert.equal((await request(path, "GET", undefined, worker.cookie)).status, 404);
    assert.equal((await request(`${path}/follow-ups`, "POST", { ...earlier, requestId: crypto.randomUUID() }, owner.cookie)).status, 404);
    assert.equal(await prisma.journalFollowUp.count({ where: { journalEntryId: entry.body.data.id } }), 3);
  } finally { await f.cleanup(); }
});
