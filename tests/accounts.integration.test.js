import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../server/src/config/database.js";
import { fixture, base, request } from "./helpers.js";

test("admin-only onboarding, username login, password change and session revocation", { skip: !base }, async () => {
  const f = fixture();
  try {
    assert.equal((await request("/auth/register", "POST", {})).status, 403);
    assert.equal((await request("/admin/clients")).status, 401);
    const admin = await f.seed("FOMS_ADMIN");
    assert.equal((await request("/dashboard", "GET", undefined, admin.cookie)).status, 403);
    const payload = { organizationName: "Client test", name: "Client owner", username: `client-${f.suffix}`, email: `client-${f.suffix}@example.test`, password: f.password };
    assert.equal((await request("/admin/clients", "POST", { ...payload, password: "weak" }, admin.cookie)).status, 400);
    const created = await request("/admin/clients", "POST", payload, admin.cookie);
    assert.equal(created.status, 201);
    f.organizations.push(created.body.data.organization.id);
    f.users.push(created.body.data.user.id);
    assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: created.body.data.organization.id } })).name, payload.organizationName);
    const clients = await request("/admin/clients", "GET", undefined, admin.cookie);
    assert.ok(clients.body.data.some((client) => client.id === created.body.data.organization.id));
    assert.equal((await request("/auth/login", "POST", { email: payload.email, password: f.password })).status, 400);
    assert.equal((await request("/auth/login", "POST", { username: payload.username, password: "wrong" })).status, 401);
    const login = await request("/auth/login", "POST", { username: payload.username.toUpperCase(), password: f.password });
    const owner = login.cookie;
    assert.equal(login.status, 200);
    assert.equal((await request("/admin/clients", "POST", payload, owner)).status, 403);
    assert.equal((await request("/auth/password", "POST", { currentPassword: "wrong", password: "New!pass8" }, owner)).status, 400);
    assert.equal((await request("/auth/password", "POST", { currentPassword: f.password, password: "Abcdefgh" }, owner)).status, 400);
    assert.equal((await request("/auth/password", "POST", { currentPassword: f.password, password: "New!pass8" }, owner)).status, 200);
    assert.equal((await request("/auth/me", "GET", undefined, owner)).status, 401);
    assert.equal((await request("/auth/refresh", "POST", {}, owner)).status, 401);
    assert.equal((await request("/auth/login", "POST", { username: payload.username, password: f.password })).status, 401);
    const newLogin = await request("/auth/login", "POST", { username: payload.username, password: "New!pass8" });
    assert.equal(newLogin.status, 200);
    assert.equal(newLogin.body.data.user.username, payload.username);
  } finally { await f.cleanup(); }
});
