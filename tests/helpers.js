import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import assert from "node:assert/strict";
import { prisma } from "../server/src/config/database.js";

export const base = process.env.FOMS_TEST_URL;
export async function request(path, method = "GET", body, cookie = "") {
  assert.ok(base && ["localhost", "127.0.0.1", "app"].includes(new URL(base).hostname), "Use only the local test stack");
  const response = await fetch(`${base}/api/v1${path}`, {
    method, headers: { "Content-Type": "application/json", Cookie: cookie },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json(), cookie: response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ") };
}
export function fixture() {
  const users = [];
  const organizations = [];
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const password = `Test!9${crypto.randomBytes(12).toString("hex")}`;
  async function seed(role = "OWNER", organizationId) {
    assert.ok(base && ["localhost", "127.0.0.1", "app"].includes(new URL(base).hostname), "Do not seed production");
    const username = `test-${crypto.randomUUID()}`;
    if (role !== "FOMS_ADMIN" && !organizationId) {
      const org = await prisma.organization.create({ data: { name: `V03 test ${username}`, slug: username } });
      organizationId = org.id;
      organizations.push(org.id);
    }
    const user = await prisma.user.create({ data: {
      name: "V03 test user", username, email: `${username}@example.test`, passwordHash: await bcrypt.hash(password, 4),
      isPlatformAdmin: role === "FOMS_ADMIN",
      ...(organizationId ? { memberships: { create: { organizationId, role } } } : {})
    } });
    users.push(user.id);
    const result = await request("/auth/login", "POST", { username, password });
    assert.equal(result.status, 200);
    return { user, organizationId, cookie: result.cookie };
  }
  async function cleanup() {
    await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
  return { seed, cleanup, users, organizations, password, suffix };
}
