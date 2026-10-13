import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, lockOrganization } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";
import { livestockSchema, livestockEventSchema } from "./livestock.validation.js";

const router = Router();
router.use(authorize("OWNER", "MANAGER"));
const farmSelect = { select: { id: true, name: true } };
const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
const scope = (req) => ({ organizationId: req.auth.organizationId, deletedAt: null, farm: { deletedAt: null } });
const eventInclude = {
  purchaseExpense: { select: { id: true, description: true, category: true, amount: true, currency: true, supplier: true, approvedAt: true, deletedAt: true } },
  saleInvoice: { select: { id: true, invoiceNumber: true, product: true, deletedAt: true } }
};
async function findRecord(tx, req) {
  const record = await tx.livestock.findFirst({ where: { ...scope(req), id: z.uuid().parse(req.params.id) } });
  if (!record) throw new AppError(404, "Livestock was not found");
  return record;
}
async function checkFarm(tx, organizationId, farmId) {
  if (!await tx.farm.findFirst({ where: { id: farmId, organizationId, deletedAt: null } })) {
    throw new AppError(400, "The selected farm is not available in this workspace");
  }
}
function checkProfile(record) {
  if (record.trackingMode === "INDIVIDUAL" && record.quantity !== 1) {
    throw new AppError(400, "An individual record must contain exactly one animal");
  }
  if (record.birthDate && record.lastVaccinated && record.lastVaccinated < record.birthDate) {
    throw new AppError(400, "Vaccination cannot be before birth / hatch date");
  }
}
const audit = (tx, req, action, id, eventId) => writeAudit({
  organizationId: req.auth.organizationId, userId: req.auth.userId, action,
  entity: eventId ? "LivestockEvent" : "Livestock", entityId: eventId || id
}, tx);

router.get("/", async (req, res, next) => {
  try {
    const query = querySchema.extend({ farmId: z.uuid().optional(), species: z.enum(["GOAT", "SHEEP", "POULTRY"]).optional() }).parse(req.query);
    const where = { ...scope(req), ...(query.farmId ? { farmId: query.farmId } : {}), ...(query.species ? { species: query.species } : {}) };
    const [data, total] = await prisma.$transaction([
      prisma.livestock.findMany({ where, include: { farm: farmSelect, _count: { select: { events: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
      prisma.livestock.count({ where })
    ]);
    res.json({ success: true, data, meta: { ...query, total } });
  } catch (error) { next(error); }
});

router.post("/", async (req, res, next) => {
  try {
    const payload = livestockSchema.parse(req.body);
    const quantity = payload.quantity ?? 1;
    const trackingMode = payload.trackingMode ?? (quantity > 1 ? "BATCH" : "INDIVIDUAL");
    checkProfile({ ...payload, quantity, trackingMode });
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      await checkFarm(tx, req.auth.organizationId, payload.farmId);
      const record = await tx.livestock.create({ data: { ...payload, quantity, initialQuantity: quantity, trackingMode, organizationId: req.auth.organizationId, createdBy: req.auth.userId } });
      await audit(tx, req, "CREATE", record.id);
      return record;
    });
    res.status(201).json({ success: true, message: "Livestock created", data });
  } catch (error) { next(error); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const record = await findRecord(prisma, req);
    const totals = await prisma.livestockEvent.groupBy({ by: ["type"], where: { livestockId: record.id }, _sum: { quantity: true, feedKg: true } });
    const sum = (type, field) => totals.find((item) => item.type === type)?._sum[field] || 0;
    const farm = await prisma.farm.findUnique({ where: { id: record.farmId }, select: { id: true, name: true } });
    res.json({ success: true, data: { ...record, farm, totals: { mortality: sum("MORTALITY", "quantity"), feedKg: sum("FEED", "feedKg"), eggs: sum("EGG_PRODUCTION", "quantity"), births: sum("BIRTH", "quantity"), purchases: sum("PURCHASE", "quantity"), sales: sum("SALE", "quantity") } } });
  } catch (error) { next(error); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const payload = livestockSchema.partial().parse(req.body);
    if (!Object.keys(payload).length) throw new AppError(400, "Provide at least one field to update");
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const existing = await findRecord(tx, req);
      const eventCount = await tx.livestockEvent.count({ where: { livestockId: existing.id } });
      if (eventCount && ["farmId", "species", "trackingMode"].some((field) => payload[field] !== undefined && payload[field] !== existing[field])) {
        throw new AppError(409, "Farm, species and tracking mode cannot change after history has been recorded");
      }
      if ((eventCount || existing.quantity === 0) && payload.quantity !== undefined && payload.quantity !== existing.quantity) {
        throw new AppError(409, "Quantity cannot be overwritten after history exists; mortality manages the living count");
      }
      for (const field of ["healthStatus", "weightKg", "lastVaccinated"]) {
        if (payload[field] !== undefined && String(payload[field]) !== String(existing[field])) {
          throw new AppError(409, "Use a health, weight or vaccination record to update observed values");
        }
      }
      const merged = { ...existing, ...payload };
      checkProfile({ ...merged, quantity: merged.quantity === 0 ? merged.initialQuantity : merged.quantity });
      if (merged.birthDate && await tx.livestockEvent.findFirst({ where: { livestockId: existing.id, occurredAt: { lt: merged.birthDate } } })) {
        throw new AppError(400, "Birth / hatch date cannot be after recorded observations");
      }
      await checkFarm(tx, req.auth.organizationId, merged.farmId);
      const record = await tx.livestock.update({ where: { id: existing.id }, data: { ...payload, ...(payload.quantity !== undefined && !eventCount && existing.quantity > 0 ? { initialQuantity: payload.quantity } : {}) } });
      await audit(tx, req, "UPDATE", record.id);
      return record;
    });
    res.json({ success: true, message: "Livestock updated", data });
  } catch (error) { next(error); }
});

router.get("/:id/events", async (req, res, next) => {
  try {
    const record = await findRecord(prisma, req);
    const query = querySchema.parse(req.query);
    const where = { livestockId: record.id };
    const [data, total] = await prisma.$transaction([
      prisma.livestockEvent.findMany({ where, include: eventInclude, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
      prisma.livestockEvent.count({ where })
    ]);
    res.json({ success: true, data, meta: { ...query, total } });
  } catch (error) { next(error); }
});

router.post("/:id/events", async (req, res, next) => {
  try {
    const payload = livestockEventSchema.parse(req.body);
    const { requestId, amount, currency, supplier, ...eventData } = payload;
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const record = await findRecord(tx, req);
      if (requestId) {
        const previous = await tx.livestockEvent.findUnique({ where: { id: requestId }, include: eventInclude });
        if (previous) {
          if (previous.livestockId !== record.id || Object.entries(eventData).some(([key, value]) =>
            (value instanceof Date ? value.toISOString() : value ?? null) !== (previous[key] instanceof Date ? previous[key].toISOString() : previous[key] ?? null)) ||
            (payload.type === "PURCHASE" && (!previous.purchaseExpense ||
              !new Prisma.Decimal(previous.purchaseExpense.amount).eq(amount) ||
              previous.purchaseExpense.currency !== currency ||
              previous.purchaseExpense.supplier !== (supplier || null)))) {
            throw new AppError(409, "This request ID has already been used for a different observation");
          }
          return previous;
        }
      }
      if (!record.quantity && !(payload.type === "PURCHASE" && record.trackingMode === "BATCH")) throw new AppError(409, "No living animals remain in this record; only a batch can be restocked");
      if (record.birthDate && payload.occurredAt < record.birthDate) throw new AppError(400, "Observation cannot be before birth / hatch date");
      if (["FEED", "EGG_PRODUCTION"].includes(payload.type) && record.species !== "POULTRY") throw new AppError(400, "Feed consumption and egg production are poultry records");
      if (["MORTALITY", "VACCINATION"].includes(payload.type) && payload.quantity > record.quantity) throw new AppError(409, "Quantity exceeds the living animals in this record");
      const update = {};
      if (payload.type === "BIRTH" && record.trackingMode !== "BATCH") {
        throw new AppError(409, "Record each offspring as a separate individual livestock profile");
      }
      if (payload.type === "PURCHASE" && record.trackingMode === "INDIVIDUAL" && payload.quantity !== 1) {
        throw new AppError(400, "An individual profile represents one purchased animal; create a separate profile for each individual");
      }
      if (["PURCHASE", "BIRTH"].includes(payload.type) && record.trackingMode === "BATCH") {
        if (record.initialQuantity + payload.quantity > 100000) throw new AppError(409, "The batch cannot exceed 100,000 animals");
        update.quantity = record.quantity + payload.quantity;
        update.initialQuantity = record.initialQuantity + payload.quantity;
      }
      if (payload.type === "MORTALITY") {
        update.quantity = record.quantity - payload.quantity;
        if (update.quantity === 0) update.healthStatus = "DECEASED";
      }
      if (payload.type === "SALE") {
        if (payload.quantity > record.quantity) throw new AppError(409, "Sale quantity exceeds the living animals in this record");
        update.quantity = record.quantity - payload.quantity;
      }
      if (payload.type === "VACCINATION" && (!record.lastVaccinated || payload.occurredAt >= record.lastVaccinated)) update.lastVaccinated = payload.occurredAt;
      if (payload.type === "HEALTH" && (!record.healthObservedAt || payload.occurredAt >= record.healthObservedAt)) {
        update.healthStatus = payload.healthStatus;
        update.healthObservedAt = payload.occurredAt;
      }
      if (payload.type === "WEIGHT" && (!record.weightObservedAt || payload.occurredAt >= record.weightObservedAt)) {
        update.weightKg = payload.weightKg;
        update.weightObservedAt = payload.occurredAt;
      }
      const event = await tx.livestockEvent.create({ data: { ...eventData, ...(requestId ? { id: requestId } : {}), livestockId: record.id, recordedBy: req.auth.userId } });
      if (payload.type === "PURCHASE") {
        await tx.expense.create({ data: {
          organizationId: req.auth.organizationId, farmId: record.farmId,
          description: `Livestock purchase - ${payload.quantity} ${record.species}${record.identifier ? ` (${record.identifier})` : ""}`,
          category: "LIVESTOCK", supplier: supplier || null, amount: new Prisma.Decimal(amount), currency,
          expenseDate: payload.occurredAt, notes: payload.notes || null, createdBy: req.auth.userId, livestockEventId: event.id
        } });
      }
      await tx.livestock.update({ where: { id: record.id }, data: update });
      await audit(tx, req, "CREATE", record.id, event.id);
      return tx.livestockEvent.findUnique({ where: { id: event.id }, include: eventInclude });
    });
    res.status(201).json({ success: true, message: payload.type === "PURCHASE" ? "Purchase recorded; linked expense is pending owner approval" : "Livestock history recorded", data });
  } catch (error) { next(error); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const record = await findRecord(tx, req);
      await tx.livestock.update({ where: { id: record.id }, data: { deletedAt: new Date() } });
      await audit(tx, req, "ARCHIVE", record.id);
    });
    res.json({ success: true, message: "Livestock archived; history retained" });
  } catch (error) { next(error); }
});

export default router;
