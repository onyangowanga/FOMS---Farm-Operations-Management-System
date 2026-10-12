import "dotenv/config";
import readline from "node:readline/promises";
import { Writable } from "node:stream";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../server/src/config/database.js";
import { accountSchema } from "../server/src/modules/auth/account.validation.js";

let muted = false;
const output = new Writable({ write(chunk, _encoding, callback) { if (!muted) process.stdout.write(chunk); callback(); } });
const terminal = readline.createInterface({ input: process.stdin, output, terminal: true });
try {
  const setupLink = process.argv.includes("--setup-link");
  const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!process.stdin.isTTY && !(setupLink && argument("name") && argument("username") && argument("email"))) throw new Error("Use an interactive trusted terminal, or --setup-link with name, username and email.");
  const profile = {
    name: argument("name") || await terminal.question("Administrator name: "),
    username: argument("username") || await terminal.question("Username: "),
    email: argument("email") || await terminal.question("Email (contact only): ")
  };
  if (setupLink) {
    const url = new URL(argument("url") || "http://localhost:3000");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Use HTTPS for a public setup link.");
    if (url.username || url.password) throw new Error("Setup URL cannot contain credentials");
    const payload = accountSchema.parse({ ...profile, password: `Unused!9${crypto.randomBytes(24).toString("hex")}` });
    const token = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(payload.password, 12);
    await prisma.user.create({ data: {
      name: payload.name, username: payload.username, email: payload.email, passwordHash, isPlatformAdmin: true,
      setupToken: { create: { tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400000) } }
    } });
    console.log(`FOMS Admin '${payload.username}' created. This private setup link expires in 24 hours and can be used once:`);
    console.log(`${url.origin}/#setup/${token}`);
  } else {
  // Suppress terminal output only while reading secrets.
  muted = true;
  process.stdout.write("Password (hidden): ");
  const password = await terminal.question("");
  process.stdout.write("\nConfirm password (hidden): ");
  const confirmation = await terminal.question("");
  muted = false;
  process.stdout.write("\n");
  if (password !== confirmation) throw new Error("Passwords do not match");
  const payload = accountSchema.parse({ ...profile, password });
  await prisma.user.create({ data: { name: payload.name, username: payload.username, email: payload.email, passwordHash: await bcrypt.hash(payload.password, 12), isPlatformAdmin: true } });
  console.log(`FOMS Admin '${payload.username}' created. Use the normal login page.`);
  }
} catch (error) {
  console.error(error.code === "P2002" ? "Username or email already exists. No account was changed." : error.message);
  process.exitCode = 1;
} finally { terminal.close(); await prisma.$disconnect(); }
