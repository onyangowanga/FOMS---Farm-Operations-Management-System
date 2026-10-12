import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { prisma } from "../server/src/config/database.js";
import { base, request } from "./helpers.js";

test("one-time admin password setup is hashed, expiring and atomic", { skip: !base }, async () => {
  assert.ok(["localhost", "127.0.0.1", "app"].includes(new URL(base).hostname), "Use only the local stack");
  const username = `setup-${crypto.randomUUID()}`;
  try {
    const child = spawn(process.execPath, ["scripts/create-admin.js", "--setup-link", "--name=Setup test", `--username=${username}`, `--email=${username}@example.test`], { env: process.env, timeout: 10000 });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    const code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    assert.equal(code, 0, output);
    const token = output.match(/#setup\/([a-f0-9]{64})/)[1];
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const stored = await prisma.accountSetupToken.findUniqueOrThrow({ where: { userId: user.id } });
    assert.notEqual(stored.tokenHash, token);
    assert.equal(stored.tokenHash, crypto.createHash("sha256").update(token).digest("hex"));
    assert.equal((await request("/auth/setup", "POST", { token: crypto.randomBytes(32).toString("hex"), password: "Setup!Pass8" })).status, 400);
    assert.equal((await request("/auth/setup", "POST", { token, password: "weak" })).status, 400);
    await prisma.accountSetupToken.update({ where: { id: stored.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await request("/auth/setup", "POST", { token, password: "Setup!Pass8" })).status, 400);
    await prisma.accountSetupToken.update({ where: { id: stored.id }, data: { expiresAt: new Date(Date.now() + 60000) } });
    const passwords = ["Setup!Pass8", "Setup!Pass9"];
    const results = await Promise.all(passwords.map((password) => request("/auth/setup", "POST", { token, password })));
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
    const password = passwords[results.findIndex((result) => result.status === 200)];
    assert.equal((await request("/auth/login", "POST", { username, password })).body.data.role, "FOMS_ADMIN");
    assert.equal((await request("/auth/setup", "POST", { token, password: "Setup!Pass0" })).status, 400);
    assert.equal(await prisma.accountSetupToken.count({ where: { userId: user.id } }), 0);
  } finally {
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  }
});
