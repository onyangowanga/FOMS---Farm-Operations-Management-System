import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../server/src/config/database.js";

const base = process.env.FOMS_TEST_URL;

test("farm structure API: hierarchy, GPS, permissions, isolation and archive safety", { skip: !base }, async () => {
  const host = new URL(base).hostname;
  assert.ok(["localhost", "127.0.0.1", "app"].includes(host), "Integration tests must use the local test stack");
  const users = [];
  const organizations = [];
  async function request(path, method = "GET", body, cookie = "") {
    const response = await fetch(`${base}/api/v1${path}`, {
      method, headers: { "Content-Type": "application/json", Cookie: cookie },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return {
      status: response.status, body: await response.json(),
      cookie: response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")
    };
  }
  async function register(label) {
    const response = await request("/auth/register", "POST", {
      name: "Structure test", organizationName: `Structure test ${label}`,
      email: `structure-${crypto.randomUUID()}@example.test`, password: crypto.randomBytes(24).toString("hex")
    });
    assert.equal(response.status, 201);
    users.push(response.body.data.user.id);
    organizations.push(response.body.data.organization.id);
    return response.cookie;
  }
  try {
    const owner = await register("owner");
    const outsider = await register("outsider");
    const workerEmail = `worker-${crypto.randomUUID()}@example.test`;
    const workerPassword = crypto.randomBytes(24).toString("hex");
    const member = await request("/team", "POST", {
      name: "Structure worker", email: workerEmail, password: workerPassword, role: "WORKER"
    }, owner);
    assert.equal(member.status, 201);
    const workerRecord = await prisma.user.findUniqueOrThrow({ where: { email: workerEmail } });
    users.push(workerRecord.id);
    const worker = (await request("/auth/login", "POST", { email: workerEmail, password: workerPassword })).cookie;
    const farmResult = await request("/farms", "POST", {
      name: "South farm", acreage: 12, latitude: -1.2921, longitude: 36.8219
    }, owner);
    assert.equal(farmResult.status, 201);
    const farm = farmResult.body.data;
    const otherFarmResult = await request("/farms", "POST", { name: "Second farm" }, owner);
    assert.equal(otherFarmResult.status, 201);
    const otherFarm = otherFarmResult.body.data;
    assert.equal((await request("/farms", "POST", { name: "Bad GPS", latitude: 91, longitude: 36 }, owner)).status, 400);
    assert.equal((await request("/farms", "POST", { name: "Half GPS", latitude: -1 }, owner)).status, 400);
    assert.equal((await request("/farms", "POST", { name: "Forbidden farm" }, worker)).status, 403);
    assert.equal((await request("/farms", "GET", undefined, worker)).status, 200);
    const blockResult = await request("/blocks", "POST", {
      farmId: farm.id, name: "Plot A", latitude: -1.3, longitude: 36.8, acreage: 3
    }, owner);
    assert.equal(blockResult.status, 201);
    const block = blockResult.body.data;
    assert.equal((await request(`/blocks/${block.id}`, "PATCH", { latitude: -1.4, longitude: 36.7, name: "Updated plot" }, owner)).status, 200);
    assert.equal((await request(`/blocks/${block.id}`, "PATCH", { latitude: 91 }, owner)).status, 400);
    assert.equal((await request(`/blocks/${block.id}`, "PATCH", { name: "Forbidden edit" }, worker)).status, 403);
    assert.equal((await request("/blocks", "POST", { farmId: farm.id, name: "Foreign block" }, outsider)).status, 400);
    assert.equal((await request(`/farms/${farm.id}`, "PATCH", { name: "Foreign edit" }, outsider)).status, 404);
    assert.equal((await request(`/farms/${farm.id}`, "DELETE", undefined, outsider)).status, 404);
    assert.equal((await request(`/blocks/${block.id}`, "PATCH", { farmId: otherFarm.id }, owner)).status, 409);
    const updated = await request(`/farms/${farm.id}`, "PATCH", { name: "Updated farm", latitude: -2 }, owner);
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.longitude, 36.8219);
    assert.equal((await request(`/farms/${farm.id}`, "PATCH", { latitude: null }, owner)).status, 400);
    const cleared = await request(`/farms/${farm.id}`, "PATCH", { latitude: null, longitude: null }, owner);
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.data.latitude, null);
    const hierarchy = await request("/organization", "GET", undefined, owner);
    assert.equal(hierarchy.status, 200);
    assert.equal(hierarchy.body.data.farms.find((item) => item.id === farm.id).blocks[0].id, block.id);
    assert.equal((await request("/organization", "GET", undefined, outsider)).body.data.farms.length, 0);
    assert.equal((await request("/organization", "PATCH", { name: "Not allowed" }, worker)).status, 403);
    assert.equal((await request("/organization", "PATCH", { name: "Updated workspace" }, owner)).status, 200);
    const filtered = await request(`/blocks?farmId=${otherFarm.id}`, "GET", undefined, owner);
    assert.equal(filtered.body.data.length, 0);
    assert.equal((await request("/farms?limit=1&page=2", "GET", undefined, owner)).body.data.length, 1);
    assert.equal((await request("/farms?limit=abc", "GET", undefined, owner)).status, 400);
    assert.equal((await request("/crops", "POST", { farmId: otherFarm.id, blockId: block.id, cropName: "Wrong farm" }, owner)).status, 400);
    const crop = await request("/crops", "POST", { farmId: farm.id, blockId: block.id, cropName: "Maize" }, owner);
    assert.equal(crop.status, 201);
    assert.equal((await request(`/crops/${crop.body.data.id}`, "PATCH", { farmId: otherFarm.id }, owner)).status, 400);
    assert.equal((await request(`/crops/${crop.body.data.id}`, "PATCH", { notes: "Keep existing block" }, owner)).status, 200);
    assert.equal((await request("/journal", "POST", { farmId: otherFarm.id, blockId: block.id, title: "Wrong plot", body: "Observation" }, worker)).status, 400);
    assert.equal((await request(`/blocks/${block.id}`, "DELETE", undefined, owner)).status, 409);
    assert.equal((await request(`/farms/${farm.id}`, "DELETE", undefined, owner)).status, 409);
    assert.equal((await request(`/crops/${crop.body.data.id}`, "DELETE", undefined, owner)).status, 200);
    assert.equal((await request(`/blocks/${block.id}`, "DELETE", undefined, owner)).status, 200);
    assert.equal((await request(`/farms/${farm.id}`, "DELETE", undefined, owner)).status, 200);
    assert.equal((await request("/organization", "GET", undefined, owner)).body.data.farms.length, 1);
    assert.equal((await request("/blocks", "POST", { farmId: farm.id, name: "Archived parent" }, owner)).status, 400);
  } finally {
    for (const id of organizations) await prisma.organization.delete({ where: { id } });
    for (const id of users) await prisma.user.delete({ where: { id } });
    await prisma.$disconnect();
  }
});
