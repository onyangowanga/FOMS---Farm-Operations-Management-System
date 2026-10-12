import crypto from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fileTypeFromBuffer } from "file-type";
import { AppError } from "./errors.js";

const uploadRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../uploads");
const imageTypes = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);

export async function storeUpload(organizationId, file, imagesOnly = false) {
  const detected = await fileTypeFromBuffer(file.buffer);
  const extension = detected && (imageTypes.get(detected.mime) || (!imagesOnly && detected.mime === "application/pdf" ? "pdf" : null));
  if (!extension) throw new AppError(415, imagesOnly ? "Upload a JPEG, PNG or WebP photo" : "Upload a PDF, JPEG, PNG or WebP file");
  const id = crypto.randomUUID();
  const filename = `${id}.${extension}`;
  const directory = path.resolve(uploadRoot, organizationId);
  await mkdir(directory, { recursive: true, mode: 0o750 });
  const savedPath = path.join(directory, filename);
  try { await writeFile(savedPath, file.buffer, { flag: "wx", mode: 0o640 }); }
  catch (error) {
    if (error.code !== "EEXIST") await removeUpload(savedPath);
    throw error;
  }
  return {
    savedPath, id, storageName: `${organizationId}/${filename}`, mimeType: detected.mime,
    originalName: path.basename(file.originalname.replaceAll("\\", "/")).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || `upload.${extension}`
  };
}

export async function removeUpload(savedPath) {
  try { await unlink(savedPath); }
  catch (error) { if (error.code !== "ENOENT") console.error("Uploaded file cleanup failed", error); }
}

export async function readUpload(storageName, organizationId) {
  const filePath = path.resolve(uploadRoot, storageName);
  const directory = `${path.resolve(uploadRoot, organizationId)}${path.sep}`;
  if (!filePath.startsWith(directory)) throw new AppError(400, "Invalid upload storage path");
  try { return await readFile(filePath); }
  catch (error) {
    if (error.code === "ENOENT") throw new AppError(404, "Uploaded file is missing from storage");
    throw error;
  }
}
