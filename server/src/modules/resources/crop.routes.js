import { Router } from "express";
import { z } from "zod";
import { prisma, lockOrganization } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";
import { cropSchema, cropTypeSchema, stageSchema, activitySchema, validateCropDates } from "./crop.validation.js";

const router = Router();
const manage = authorize("OWNER", "MANAGER", "AGRONOMIST");
const where = (req) => ({ organizationId: req.auth.organizationId, deletedAt: null });
async function findCrop(tx, req) {
  const crop = await tx.cropCycle.findFirst({ where: { ...where(req), id: z.uuid().parse(req.params.id) } });
  if (!crop) throw new AppError(404, "Crop cycle not found");
  return crop;
}
async function related(tx, org, payload) {
  if (!await tx.farm.findFirst({ where: { id: payload.farmId, organizationId: org, deletedAt: null } })) throw new AppError(400, "Selected farm is unavailable");
  if (payload.blockId && !await tx.block.findFirst({ where: { id: payload.blockId, farmId: payload.farmId, organizationId: org, deletedAt: null } })) throw new AppError(400, "Selected block does not belong to this farm");
  if (payload.cropTypeId && !await tx.cropType.findFirst({ where: { id: payload.cropTypeId, organizationId: org } })) throw new AppError(400, "Selected crop type is unavailable");
}
async function audit(tx, req, action, id, entity = "CropCycle") {
  await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action, entity, entityId: id }, tx);
}
router.get("/types", async (req, res, next) => {
  try { res.json({ success: true, data: await prisma.cropType.findMany({ where: { organizationId: req.auth.organizationId }, orderBy: { name: "asc" } }) }); }
  catch (error) { next(error); }
});
router.post("/types", manage, async (req, res, next) => {
  try {
    const payload = cropTypeSchema.parse(req.body);
    if (payload.requiresNursery && !payload.nurseryDays) throw new AppError(400, "Provide the default nursery duration");
    const data = await prisma.$transaction(async (tx) => {
      const record = await tx.cropType.create({ data: { ...payload, organizationId: req.auth.organizationId } });
      await audit(tx, req, "CREATE", record.id, "CropType");
      return record;
    });
    res.status(201).json({ success: true, message: "Crop type saved", data });
  } catch (error) { next(error); }
});
router.patch("/types/:typeId", manage, async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.typeId);
    const payload = cropTypeSchema.partial().parse(req.body);
    if (!Object.keys(payload).length) throw new AppError(400, "Provide fields to update");
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const type = await tx.cropType.findFirst({ where: { id, organizationId: req.auth.organizationId } });
      if (!type) throw new AppError(404, "Crop type not found");
      const merged = { ...type, ...payload };
      if (merged.requiresNursery && !merged.nurseryDays) throw new AppError(400, "Provide the default nursery duration");
      const record = await tx.cropType.update({ where: { id }, data: payload });
      await audit(tx, req, "UPDATE", id, "CropType");
      return record;
    });
    res.json({ success: true, message: "Crop type updated. Existing cycles are unchanged.", data });
  } catch (error) { next(error); }
});
router.get("/", async (req, res, next) => {
  try {
    const page = z.coerce.number().int().min(1).parse(req.query.page ?? 1);
    const limit = z.coerce.number().int().min(1).max(100).parse(req.query.limit ?? 50);
    const filter = where(req);
    if (req.query.farmId) filter.farmId = z.uuid().parse(req.query.farmId);
    const [data, total] = await Promise.all([prisma.cropCycle.findMany({ where: filter, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" } }), prisma.cropCycle.count({ where: filter })]);
    res.json({ success: true, data, meta: { page, limit, total } });
  } catch (error) { next(error); }
});
router.post("/", manage, async (req, res, next) => {
  try {
    const payload = cropSchema.parse(req.body);
    validateCropDates(payload);
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      await related(tx, req.auth.organizationId, payload);
      const crop = await tx.cropCycle.create({ data: { ...payload, organizationId: req.auth.organizationId, createdBy: req.auth.userId } });
      await tx.cropStage.create({ data: { cropId: crop.id, stage: crop.status, recordedBy: req.auth.userId, notes: "Cycle created" } });
      await audit(tx, req, "CREATE", crop.id);
      return crop;
    });
    res.status(201).json({ success: true, message: "Crop cycle created", data });
  } catch (error) { next(error); }
});
router.get("/:id", async (req, res, next) => {
  try {
    const crop = await findCrop(prisma, req);
    const [stages, activities] = await Promise.all([
      prisma.cropStage.findMany({ where: { cropId: crop.id }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }] }),
      prisma.cropActivity.findMany({ where: { cropId: crop.id }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }] })
    ]);
    res.json({ success: true, data: { ...crop, stages, activities } });
  } catch (error) { next(error); }
});
router.patch("/:id", manage, async (req, res, next) => {
  try {
    const payload = cropSchema.omit({ status: true }).partial().parse(req.body);
    if (!Object.keys(payload).length) throw new AppError(400, "Provide fields to update; use stage tracking to change lifecycle stage");
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const crop = await findCrop(tx, req);
      const merged = { ...crop, ...payload };
      validateCropDates(merged);
      await related(tx, req.auth.organizationId, merged);
      const result = await tx.cropCycle.update({ where: { id: crop.id }, data: payload });
      await audit(tx, req, "UPDATE", crop.id);
      return result;
    });
    res.json({ success: true, message: "Crop details updated", data });
  } catch (error) { next(error); }
});
router.post("/:id/stages", manage, async (req, res, next) => {
  try {
    const payload = stageSchema.parse(req.body);
    if (payload.occurredAt > new Date()) throw new AppError(400, "A stage observation cannot be in the future");
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const crop = await findCrop(tx, req);
      if (crop.status === payload.stage) throw new AppError(409, "Crop is already in this stage");
      validateCropDates({ ...crop, status: payload.stage });
      const latest = await tx.cropStage.findFirst({ where: { cropId: crop.id }, orderBy: { occurredAt: "desc" } });
      if (latest && payload.occurredAt < latest.occurredAt) throw new AppError(400, "Stage observation must not precede the latest stage record");
      const record = await tx.cropStage.create({ data: { ...payload, cropId: crop.id, recordedBy: req.auth.userId } });
      await tx.cropCycle.update({ where: { id: crop.id }, data: { status: payload.stage } });
      await audit(tx, req, "CHANGE_STAGE", crop.id);
      return record;
    });
    res.status(201).json({ success: true, message: "Stage updated and recorded in history", data });
  } catch (error) { next(error); }
});
router.post("/:id/activities", manage, async (req, res, next) => {
  try {
    const payload = activitySchema.parse(req.body);
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const crop = await findCrop(tx, req);
      const record = await tx.cropActivity.create({ data: { ...payload, cropId: crop.id, recordedBy: req.auth.userId } });
      await audit(tx, req, `RECORD_${payload.type}`, crop.id);
      return record;
    });
    res.status(201).json({ success: true, message: "Crop activity recorded", data });
  } catch (error) { next(error); }
});
router.delete("/:id", manage, async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const crop = await findCrop(tx, req);
      await tx.cropCycle.update({ where: { id: crop.id }, data: { deletedAt: new Date() } });
      await audit(tx, req, "ARCHIVE", crop.id);
    });
    res.json({ success: true, message: "Crop archived; its history is preserved" });
  } catch (error) { next(error); }
});
export default router;
