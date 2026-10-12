import path from "node:path";
import { rmdir } from "node:fs/promises";
import { prisma } from "../server/src/config/database.js";
import { removeUpload } from "../server/src/shared/uploads.js";
import { base } from "./helpers.js";
import assert from "node:assert/strict";

export const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVYkAAAAASUVORK5CYII=", "base64");
export async function uploadEvidence(taskId, cookie, data = png, name = "evidence.png") {
  assert.ok(base && ["localhost", "127.0.0.1", "app"].includes(new URL(base).hostname));
  const form = new FormData();
  form.set("file", new Blob([data]), name);
  const response = await fetch(`${base}/api/v1/tasks/${taskId}/evidence`, { method: "POST", headers: { Cookie: cookie }, body: form });
  return { status: response.status, body: await response.json() };
}
export async function cleanupTaskEvidence(f) {
  const files = await prisma.taskEvidence.findMany({ where: { task: { organizationId: { in: f.organizations } } }, select: { storageName: true } });
  for (const file of files) await removeUpload(path.resolve("uploads", file.storageName));
  for (const organizationId of new Set(files.map((file) => file.storageName.split("/")[0]))) {
    try { await rmdir(path.resolve("uploads", organizationId)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
