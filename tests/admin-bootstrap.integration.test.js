import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { prisma } from "../server/src/config/database.js";
import { base } from "./helpers.js";

test("trusted CLI creates platform admin without printing passwords", { skip: !base, timeout: 15000 }, async () => {
  assert.ok(["localhost", "127.0.0.1", "app"].includes(new URL(base).hostname), "Use the local stack only");
  const username = `bootstrap-${crypto.randomUUID()}`;
  const password = `Secret!9${crypto.randomBytes(12).toString("hex")}`;
  try {
    const child = spawn(process.execPath, ["--input-type=module", "-e", "Object.defineProperty(process.stdin, 'isTTY', { value: true }); await import('./scripts/create-admin.js');"], { env: process.env, timeout: 10000 });
    let output = "";
    const prompts = [
      ["Administrator name: ", "Bootstrap test"],
      ["Username: ", username],
      ["Email (contact only): ", `${username}@example.test`],
      ["Password (hidden): ", password],
      ["Confirm password (hidden): ", password]
    ];
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (prompts.length && output.includes(prompts[0][0])) child.stdin.write(`${prompts.shift()[1]}\n`);
    });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    const code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    assert.equal(code, 0, output);
    assert.equal(output.includes(password), false, "Secret must not appear in terminal output");
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    assert.equal(user.isPlatformAdmin, true);
    assert.equal(await prisma.membership.count({ where: { userId: user.id } }), 0);
  } finally {
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  }
});
