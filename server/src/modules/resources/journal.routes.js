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
  incidentSeverity: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable().optional(),
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
  if (value.incidentSeverity && !isIncident(value)) ctx.addIssue({ code: "custom", path: ["incidentSeverity"], message: "Severity applies only to pest or disease incidents" });
});
const isIncident = (record) => record.category === "PEST_DISEASE" || Boolean(record.incident?.trim());
const followUpSchema = z.object({
  requestId: z.uuid(),
  notes: z.string().trim().min(2).max(4000),
  observedAt: z.coerce.date(),
  incidentStatus: z.enum(["OPEN", "RESOLVED"]),
  incidentSeverity: z.enum(["LOW", "MEDIUM", "HIGH"]).optional()
}).strict();
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  farmId: z.uuid().optional(), cropId: z.uuid().optional(), livestockId: z.uuid().optional(),
  subjectType: z.enum(["GENERAL", "CROP", "LIVESTOCK"]).optional(),
  category: z.string().trim().min(2).max(50).optional(),
  incidentStatus: z.enum(["OPEN", "RESOLVED"]).optional(),
  search: z.string().trim().max(200).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional()
}).strict().refine((query) => !query.from || !query.to || new Date(query.from) <= new Date(query.to), { message: "Start date must not be after end date" });
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
  farm: { select: { id: true, name: true } },   crop: { select: { id: true, cropName: true, variety: true, block: { select: { name: true } } } },
  livestock: { select: { id: true, species: true, identifier: true } }, author: { select: { id: true, name: true } },
  _count: { select: { followUps: true } }
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
    const { page, limit, search, from, to, ...filters } = querySchema.parse(req.query);
    const where = {
      ...whereFor(req), ...filters,
      ...(search ? { OR: ["title", "body", "weather", "incident"].map((key) => ({ [key]: { contains: search, mode: "insensitive" } })) } : {}),
      ...(from || to ? { observedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {})
    };
    const [records, total] = await Promise.all([
      prisma.journalEntry.findMany({ where, include, orderBy: [{ observedAt: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit }),
      prisma.journalEntry.count({ where })
    ]);
    res.json({ success: true, data: records.map(publicReport), meta: { page, limit, total } });
  } catch (error) { next(error); }
});
router.post("/", upload.single("photo"), async (req, res, next) => {
  let stored;
  try {
    const payload = schema.parse(req.body);
    if (req.auth.role === "WORKER" && payload.incidentSeverity) throw new AppError(403, "Only owners, managers and agronomists assess incident severity");
    const record = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      await validateRelated(tx, req.auth.organizationId, payload);
      if (req.file) stored = await storeUpload(req.auth.organizationId, req.file, true);
      const record = await tx.journalEntry.create({ data: {
        ...payload, organizationId: req.auth.organizationId, authorId: req.auth.userId,
        ...(isIncident(payload) ? { incidentStatus: "OPEN", incidentUpdatedAt: payload.observedAt } : {}),
        ...(stored ? { photoStorageName: stored.storageName, photoMimeType: stored.mimeType, photoOriginalName: stored.originalName } : {})
      }, include });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "CREATE", entity: "JournalEntry", entityId: record.id }, tx);
      return record;
    });
    router.get("/:id", async (req, res, next) => {
      try {
        const record = await prisma.journalEntry.findFirst({
          where: whereFor(req, z.uuid().parse(req.params.id)),
          include: { ...include, followUps: {
            where: { organizationId: req.auth.organizationId },
            include: { author: { select: { id: true, name: true } } },
            orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }]
          } }
        });
        if (!record) throw new AppError(404, "Report was not found");
        res.json({ success: true, data: publicReport(record) });
      } catch (error) { next(error); }
    });
    router.post("/:id/follow-ups", authorize("OWNER", "MANAGER", "AGRONOMIST"), async (req, res, next) => {
      try {
        const id = z.uuid().parse(req.params.id);
        const payload = followUpSchema.parse(req.body);
        const record = await prisma.$transaction(async (tx) => {
          await lockOrganization(tx, req.auth.organizationId);
          const entry = await tx.journalEntry.findFirst({ where: whereFor(req, id) });
          if (!entry) throw new AppError(404, "Report was not found");
          if (!entry.incidentStatus) throw new AppError(409, "Follow-ups are available only for incident reports");
          const existing = await tx.journalFollowUp.findUnique({ where: { journalEntryId_requestId: { journalEntryId: id, requestId: payload.requestId } } });
          if (existing) {
            if (existing.recordedBy !== req.auth.userId || existing.notes !== payload.notes || existing.observedAt.getTime() !== payload.observedAt.getTime() ||
              existing.incidentStatus !== payload.incidentStatus || (payload.incidentSeverity && existing.incidentSeverity !== payload.incidentSeverity)) throw new AppError(409, "This request ID has already been used for a different follow-up");
            return existing;
          }
          if (payload.observedAt > new Date() || payload.observedAt < entry.observedAt) throw new AppError(400, "Follow-up time must be between the original observation and now");
          const severity = payload.incidentSeverity ?? entry.incidentSeverity;
          const followUp = await tx.journalFollowUp.create({ data: {
            ...payload, incidentSeverity: severity, organizationId: req.auth.organizationId,
            journalEntryId: id, recordedBy: req.auth.userId
          } });
          if (!entry.incidentUpdatedAt || payload.observedAt >= entry.incidentUpdatedAt) await tx.journalEntry.update({
            where: { id }, data: { incidentStatus: payload.incidentStatus, incidentSeverity: severity, incidentUpdatedAt: payload.observedAt }
          });
          await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "FOLLOW_UP", entity: "JournalEntry", entityId: id }, tx);
          return followUp;
        });
        res.status(201).json({ success: true, message: "Incident follow-up saved; history is preserved", data: record });
      } catch (error) { next(error); }
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
    if (req.auth.role === "WORKER" && Object.hasOwn(payload, "incidentSeverity")) throw new AppError(403, "Only owners, managers and agronomists assess incident severity");
    const record = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const existing = await tx.journalEntry.findFirst({ where: whereFor(req, id) });
      if (!existing) throw new AppError(404, "Report was not found");
      const fields = Object.fromEntries(Object.keys(inputSchema.shape).map((key) => [key, existing[key]]));
      const mergedInput = { ...fields, ...payload };
      if (existing.incidentStatus && !isIncident(mergedInput)) throw new AppError(409, "A tracked incident must remain an incident report");
      const merged = schema.parse(mergedInput);
      const followUps = await tx.journalFollowUp.count({ where: { journalEntryId: id, organizationId: req.auth.organizationId } });
      if (followUps && (Object.hasOwn(payload, "observedAt") || Object.hasOwn(payload, "incidentSeverity"))) throw new AppError(409, "After follow-ups, retain the original observation time and use a follow-up to change severity");
      const subjectChanged = ["farmId", "blockId", "cropId", "livestockId", "subjectType"].some((key) => merged[key] !== existing[key]);
      if (followUps && subjectChanged) throw new AppError(409, "Retain the original incident subject after follow-ups");
      if (subjectChanged) await validateRelated(tx, req.auth.organizationId, merged);
      const record = await tx.journalEntry.update({ where: { id }, data: {
        ...payload,
        ...(!followUps && isIncident(merged) ? { incidentStatus: existing.incidentStatus || "OPEN", incidentUpdatedAt: merged.observedAt } : {})
      }, include });
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
