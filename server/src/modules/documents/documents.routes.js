import crypto from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 4, fieldSize: 2000 }
});
const uploadRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../uploads");
const allowedTypes = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);
const categories = ["SOIL_REPORT", "WATER_ANALYSIS", "PATHOLOGY_REPORT", "FARM_LICENSE", "PURCHASE_RECEIPT", "AGRONOMIST_REPORT", "FARM_PHOTO", "OTHER"];

router.get("/", async (req, res, next) => {
  try {
    const documents = await prisma.document.findMany({
      where: {
        organizationId: req.auth.organizationId,
        deletedAt: null,
        ...(req.auth.role === "WORKER" ? { category: "FARM_PHOTO" } : {})
      },
      orderBy: { createdAt: "desc" },
      include: { farm: { select: { id: true, name: true } }, uploader: { select: { id: true, name: true } } }
    });
    res.json({ success: true, data: documents });
  } catch (error) { next(error); }
});

router.post("/", authorize("OWNER", "MANAGER", "AGRONOMIST", "WORKER"), upload.single("file"), async (req, res, next) => {
  let savedPath;
  try {
    if (!req.file) throw new AppError(400, "Choose a document or photo to upload");
    const category = z.enum(categories).parse(req.body.category);
    if (req.auth.role === "WORKER" && category !== "FARM_PHOTO") {
      throw new AppError(403, "Farm workers may upload farm photos only");
    }
    const farmId = req.body.farmId ? z.uuid().parse(req.body.farmId) : null;
    if (farmId && !(await prisma.farm.findFirst({
      where: { id: farmId, organizationId: req.auth.organizationId, deletedAt: null },
      select: { id: true }
    }))) throw new AppError(400, "The selected farm is not available in this workspace");

    const detected = await fileTypeFromBuffer(req.file.buffer);
    const extension = detected && allowedTypes.get(detected.mime);
    if (!detected || !extension) {
      throw new AppError(415, "Unsupported file type. Upload a PDF, JPEG, PNG, or WebP file.");
    }
    const id = crypto.randomUUID();
    const storageName = `${req.auth.organizationId}/${id}.${extension}`;
    const organizationDirectory = path.resolve(uploadRoot, req.auth.organizationId);
    await mkdir(organizationDirectory, { recursive: true, mode: 0o750 });
    savedPath = path.join(organizationDirectory, `${id}.${extension}`);
    await writeFile(savedPath, req.file.buffer, { flag: "wx", mode: 0o640 });
    const originalName = path.basename(req.file.originalname.replaceAll("\\", "/")).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || `upload.${extension}`;
    const document = await prisma.document.create({
      data: {
        id,
        organizationId: req.auth.organizationId,
        farmId,
        category,
        originalName,
        storageName,
        mimeType: detected.mime,
        sizeBytes: req.file.size,
        description: req.body.description ? z.string().trim().max(500).parse(req.body.description) : null,
        uploadedBy: req.auth.userId
      },
      include: { farm: { select: { id: true, name: true } }, uploader: { select: { id: true, name: true } } }
    });
    await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "UPLOAD", entity: "Document", entityId: document.id });
    res.status(201).json({ success: true, message: "Document uploaded", data: document });
  } catch (error) {
    if (savedPath) await unlink(savedPath).catch((cleanupError) => console.error("Uploaded file cleanup failed", cleanupError));
    next(error);
  }
});

router.get("/:id/download", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.id);
    const document = await prisma.document.findFirst({
      where: {
        id,
        organizationId: req.auth.organizationId,
        deletedAt: null,
        ...(req.auth.role === "WORKER" ? { category: "FARM_PHOTO" } : {})
      }
    });
    if (!document) throw new AppError(404, "Document was not found");
    const filePath = path.resolve(uploadRoot, document.storageName);
    if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) throw new AppError(400, "Invalid document storage path");
    const content = await readFile(filePath);
    res.setHeader("Content-Type", document.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(document.originalName)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(content);
  } catch (error) {
    if (error.code === "ENOENT") return next(new AppError(404, "Document file is missing from storage"));
    next(error);
  }
});

router.delete("/:id", authorize("OWNER", "MANAGER", "AGRONOMIST"), async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.id);
    const result = await prisma.document.updateMany({
      where: { id, organizationId: req.auth.organizationId, deletedAt: null },
      data: { deletedAt: new Date() }
    });
    if (!result.count) throw new AppError(404, "Document was not found");
    await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "DELETE", entity: "Document", entityId: id });
    res.json({ success: true, message: "Document archived" });
  } catch (error) { next(error); }
});

export default router;
