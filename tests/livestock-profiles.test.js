import test from "node:test";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { base, fixture, request } from "./helpers.js";
import { prisma } from "../server/src/config/database.js";
import { livestockEventSchema } from "../server/src/modules/resources/livestock.validation.js";

test("livestock observations validate quantities, dates and type-specific fields", () => {
  const occurredAt = new Date(Date.now() - 60000).toISOString();
  for (const payload of [
    { type: "MORTALITY", quantity: 0, title: "Unknown", occurredAt },
    { type: "MORTALITY", quantity: 1.5, title: "Unknown", occurredAt },
    { type: "VACCINATION", quantity: 1, title: "Vaccine", occurredAt, nextDueAt: "2000-01-01" },
    { type: "WEIGHT", weightKg: 0, occurredAt },
    { type: "FEED", feedKg: -1, title: "Mash", occurredAt },
    { type: "EGG_PRODUCTION", quantity: 2, occurredAt: "2999-01-01" },
    { type: "HEALTH", healthStatus: "DECEASED", title: "Invalid", occurredAt },
    { type: "WEIGHT", weightKg: 2, quantity: 3, occurredAt }
  ]) assert.equal(livestockEventSchema.safeParse(payload).success, false);
  assert.equal(livestockEventSchema.safeParse({ type: "FEED", feedKg: 0.25, title: "Mash", occurredAt }).success, true);
});

test("additive livestock migration preserves legacy groups, vaccination dates and deceased history", { skip: !base }, async () => {
  assert.ok(["localhost", "127.0.0.1", "app"].includes(new URL(base).hostname));
  const schema = `v04_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const rollback = new Error("Rollback isolated migration test");
  const sql = await readFile(new URL("../server/prisma/migrations/20261012100000_v04_livestock/migration.sql", import.meta.url), "utf8");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe('CREATE TABLE "Livestock" ("id" UUID PRIMARY KEY, "quantity" INTEGER NOT NULL, "healthStatus" TEXT NOT NULL, "lastVaccinated" TIMESTAMP(3))');
      await tx.$executeRawUnsafe(`INSERT INTO "Livestock" VALUES ('00000000-0000-0000-0000-000000000001',1,'HEALTHY','2025-01-01'),('00000000-0000-0000-0000-000000000002',20,'HEALTHY',NULL),('00000000-0000-0000-0000-000000000003',5,'DECEASED',NULL)`);
      for (const statement of sql.split(";").filter((value) => value.trim())) await tx.$executeRawUnsafe(statement);
      const records = await tx.$queryRawUnsafe('SELECT * FROM "Livestock" ORDER BY "id"');
      assert.deepEqual(records.map((item) => [item.trackingMode, item.initialQuantity, item.quantity]), [["INDIVIDUAL", 1, 1], ["BATCH", 20, 20], ["BATCH", 5, 0]]);
      assert.equal(records[0].lastVaccinated.toISOString(), "2025-01-01T00:00:00.000Z");
      assert.equal((await tx.$queryRawUnsafe('SELECT COUNT(*) AS count FROM "LivestockEvent"'))[0].count, 0n);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await prisma.$disconnect(); }
});

test("all species support individuals and batches, with tenant/RBAC isolation and retained archives", { skip: !base }, async () => {
  const f = fixture();
  try {
    assert.equal((await request("/livestock")).status, 401);
    const owner = await f.seed();
    const manager = await f.seed("MANAGER", owner.organizationId);
    const worker = await f.seed("WORKER", owner.organizationId);
    const agronomist = await f.seed("AGRONOMIST", owner.organizationId);
    const outsider = await f.seed();
    const farm = (await request("/farms", "POST", { name: "Livestock profiles" }, owner.cookie)).body.data;
    const foreignFarm = (await request("/farms", "POST", { name: "Other tenant" }, outsider.cookie)).body.data;
    assert.equal((await request("/livestock", "POST", { farmId: foreignFarm.id, species: "GOAT" }, owner.cookie)).status, 400);
    assert.equal((await request("/livestock", "POST", { farmId: farm.id, species: "GOAT", trackingMode: "INDIVIDUAL", quantity: 2 }, owner.cookie)).status, 400);
    const records = [];
    for (const species of ["GOAT", "SHEEP", "POULTRY"]) for (const trackingMode of ["INDIVIDUAL", "BATCH"]) {
      const result = await request("/livestock", "POST", { farmId: farm.id, species, trackingMode, quantity: trackingMode === "BATCH" ? 5 : 1, identifier: `${species}-${trackingMode}`, birthDate: "2025-01-01" }, manager.cookie);
      assert.equal(result.status, 201);
      assert.equal(result.body.data.initialQuantity, result.body.data.quantity);
      records.push(result.body.data);
    }
    const record = records[0];
    const path = `/livestock/${record.id}`;
    for (const cookie of [worker.cookie, agronomist.cookie]) {
      assert.equal((await request("/livestock", "GET", undefined, cookie)).status, 403);
      assert.equal((await request(path, "GET", undefined, cookie)).status, 403);
      assert.equal((await request(`${path}/events`, "POST", { type: "HEALTH", title: "Healthy", healthStatus: "HEALTHY", occurredAt: "2026-01-01" }, cookie)).status, 403);
    }
    assert.equal((await request(path, "GET", undefined, outsider.cookie)).status, 404);
    assert.equal((await request(`${path}/events`, "GET", undefined, outsider.cookie)).status, 404);
    assert.equal((await request(path, "PATCH", { notes: "Other tenant" }, outsider.cookie)).status, 404);
    assert.equal((await request("/livestock?species=POULTRY&limit=1", "GET", undefined, owner.cookie)).body.meta.total, 2);
    const update = await request(path, "PATCH", { breed: "Local", notes: "Profile updated" }, manager.cookie);
    assert.equal(update.status, 200);
    assert.equal((await request(path, "GET", undefined, owner.cookie)).body.data.breed, "Local");
    assert.equal((await request(`${path}/events`, "POST", { type: "HEALTH", title: "Check", healthStatus: "HEALTHY", occurredAt: "2026-01-01" }, owner.cookie)).status, 201);
    assert.equal((await request(path, "PATCH", { trackingMode: "BATCH" }, owner.cookie)).status, 409);
    assert.equal((await request(path, "DELETE", undefined, manager.cookie)).status, 200);
    assert.equal((await request(path, "GET", undefined, owner.cookie)).status, 404);
    assert.equal(await prisma.livestockEvent.count({ where: { livestockId: record.id } }), 1);
    assert.equal((await request("/livestock", "GET", undefined, owner.cookie)).body.meta.total, 5);
  } finally { await f.cleanup(); }
});
