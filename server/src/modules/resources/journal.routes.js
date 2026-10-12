import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma, lockOrganization } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";
import { storeUpload, readUpload, removeUpload } from "../../shared/uploads.js";

const router = Router();
router.use(authorize("OWNER", "MANAGER", "AGRONOMIST", "WORKER"));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 16, fieldSize: 12000 } });
const nullableId = z.preprocess((value) => value === "" ? null : value, z.uuid().nullable().optional());
const inputSchema = z.object({
  farmId: nullableId, cropId: nullableId, livestockId: nullableId,
  subjectType: z.enum(["GENERAL", "CROP", "LIVESTOCK"]).optional(),
  title: z.string().trim().min(2).max(160), body: z.string().trim().min(2).max(10000),
  category: z.string().trim().min(2).max(50).optional(),
  observedAt: z.coerce.date().optional(),
  weather: z.string().trim().max(2000).nullable().optional(),
  incident: z.string().trim().max(2000).nullable().optional(),
  cost: z.coerce.number().finite().nonnegative().optional(),
  blockId: nullableId
}).strict();
const schema = inputSchema.extend({
  subjectType: inputSchema.shape.subjectType.default("GENERAL"),
  category: inputSchema.shape.category.default("OBSERVATION"),
  observedAt: inputSchema.shape.observedAt.default(() => new Date()),
  cost: inputSchema.shape.cost.default(0)
}).superRefine((value, ctx) => {
  if (value.subjectType === "CROP" && !value.cropId) ctx.addIssue({ code: "custom", path: ["cropId"], message: "Select the observed crop" });
  if (value.subjectType === "LIVESTOCK" && !value.livestockId) ctx.addIssue({ code: "custom", path: ["livestockId"], message: "Select the observed livestock" });
  if ((value.cropId && value.subjectType !== "CROP") || (value.livestockId && value.subjectType !== "LIVESTOCK")) ctx.addIssue({ code: "custom", path: ["subjectType"], message: "Report subject does not match the selected crop or livestock" });
  if (value.subjectType !== "GENERAL" && !value.farmId) ctx.addIssue({ code: "custom", path: ["farmId"], message: "Select the associated farm" });
  if (value.observedAt > new Date()) ctx.addIssue({ code: "custom", path: ["observedAt"], message: "Observation cannot be in the future" });
});
async function validateRelated(tx, organizationId, payload) {
  const where = { organizationId, deletedAt: null };
  if (payload.farmId && !await tx.farm.findFirst({ where: { ...where, id: payload.farmId } })) throw new AppError(400, "Selected farm is not available in this workspace");
  for (const [key, delegate] of [["cropId", "cropCycle"], ["livestockId", "livestock"], ["blockId", "block"]]) {
    if (payload[key] && (!payload.farmId || !await tx[delegate].findFirst({ where: { ...where, id: payload[key], farmId: payload.farmId } }))) throw new AppError(400, "Selected crop, livestock or block does not belong to this farm");
  }
}
const whereFor = (req, id) => ({
  ...(id ? { id } : {}), organizationId: req.auth.organizationId, deletedAt: null,
  ...(req.auth.role === "WORKER" ? { authorId: req.auth.userId } : {})
});
const include = {
  farm: { select: { id: true, name: true } }, crop: { select: { id: true, cropName: true, variety: true } },
  livestock: { select: { id: true, species: true, identifier: true } }, author: { select: { id: true, name: true } }
};
function publicReport(record) {
  const { photoStorageName, photoMimeType, photoOriginalName, ...data } = record;
  return { ...data, photoPath: photoStorageName ? `/api/v1/journal/${record.id}/photo` : null };
}
router.get("/selectors", async (req, res, next) => {
  try {
    const where = { organizationId: req.auth.organizationId, deletedAt: null };
    const [farms, crops, livestock] = await Promise.all([
      prisma.farm.findMany({ where, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.cropCycle.findMany({ where: { ...where, farm: { deletedAt: null } }, select: { id: true, farmId: true, cropName: true, variety: true, block: { select: { name: true } } }, orderBy: { cropName: "asc" } }),
      prisma.livestock.findMany({ where: { ...where, farm: { deletedAt: null } }, select: { id: true, farmId: true, species: true, identifier: true }, orderBy: { species: "asc" } })
    ]);
    res.json({ success: true, data: { farms, crops, livestock } });
  } catch (error) { next(error); }
});
router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const where = whereFor(req);
    const [records, total] = await Promise.all([
      prisma.journalEntry.findMany({ where, include, orderBy: { observedAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.journalEntry.count({ where })
    ]);
    res.json({ success: true, data: records.map(publicReport), meta: { page, limit, total } });
  } catch (error) { next(error); }
});
router.post("/", upload.single("photo"), async (req, res, next) => {
  let stored;
  try {
    const payload = schema.parse(req.body);
    const record = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      await validateRelated(tx, req.auth.organizationId, payload);
      if (req.file) stored = await storeUpload(req.auth.organizationId, req.file, true);
      const record = await tx.journalEntry.create({ data: {
        ...payload, organizationId: req.auth.organizationId, authorId: req.auth.userId,
        ...(stored ? { photoStorageName: stored.storageName, photoMimeType: stored.mimeType, photoOriginalName: stored.originalName } : {})
      }, include });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "CREATE", entity: "JournalEntry", entityId: record.id }, tx);
      return record;
    });
    stored = null;
    res.status(201).json({ success: true, message: "Daily report saved", data: publicReport(record) });
  } catch (error) {
    if (stored) await removeUpload(stored.savedPath);
    next(error);
  }
});
router.get("/:id/photo", async (req, res, next) => {
  try {
    const record = await prisma.journalEntry.findFirst({ where: whereFor(req, z.uuid().parse(req.params.id)) });
    if (!record?.photoStorageName) throw new AppError(404, "Report photo was not found");
    const data = await readUpload(record.photoStorageName, req.auth.organizationId);
    res.setHeader("Content-Type", record.photoMimeType);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(record.photoOriginalName)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(data);
  } catch (error) { next(error); }
});
router.patch("/:id", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.id);
    const payload = inputSchema.partial().parse(req.body);
    if (!Object.keys(payload).length) throw new AppError(400, "Provide at least one field to update");
    const record = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const existing = await tx.journalEntry.findFirst({ where: whereFor(req, id) });
      if (!existing) throw new AppError(404, "Report was not found");
      const fields = Object.fromEntries(Object.keys(inputSchema.shape).map((key) => [key, existing[key]]));
      const merged = schema.parse({ ...fields, ...payload });
      await validateRelated(tx, req.auth.organizationId, merged);
      const record = await tx.journalEntry.update({ where: { id }, data: payload, include });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "UPDATE", entity: "JournalEntry", entityId: id }, tx);
      return record;
    });
    res.json({ success: true, message: "Daily report updated", data: publicReport(record) });
  } catch (error) { next(error); }
});
router.delete("/:id", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.id);
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const result = await tx.journalEntry.updateMany({ where: whereFor(req, id), data: { deletedAt: new Date() } });
      if (!result.count) throw new AppError(404, "Report was not found");
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "ARCHIVE", entity: "JournalEntry", entityId: id }, tx);
    });
    res.json({ success: true, message: "Daily report archived; history is preserved" });
  } catch (error) { next(error); }
});
export default router;
