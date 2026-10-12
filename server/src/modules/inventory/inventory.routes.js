import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, lockOrganization } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";
import { categories, itemFields, itemSchema, movementSchema, assetEventSchema } from "./inventory.validation.js";

const router = Router();
const managers = ["OWNER", "MANAGER"];
router.use(authorize(...managers, "AGRONOMIST"));
const scope = (req, id) => ({ organizationId: req.auth.organizationId, deletedAt: null, ...(id ? { id } : {}) });
const include = { farm: { select: { id: true, name: true } }, _count: { select: { movements: true, assetEvents: true } } };
const lowStock = (item) => item.trackingMode === "BATCH" && item.quantity.lte(item.reorderLevel);
function publicItem(item) {
  const { lowStockAlertActive, creationRequestId, ...data } = item;
  return { ...data, quantity: Number(item.quantity), reorderLevel: Number(item.reorderLevel), lowStock: lowStock(item) };
}
const publicMovement = (record) => ({ ...record, quantity: Number(record.quantity), balanceAfter: record.balanceAfter === null ? null : Number(record.balanceAfter) });
async function findItem(tx, req, id) {
  const item = await tx.inventoryItem.findFirst({ where: scope(req, id), include });
  if (!item) throw new AppError(404, "Inventory item was not found");
  return item;
}
async function validateFarm(tx, req, farmId) {
  if (farmId && !await tx.farm.findFirst({ where: scope(req, farmId) })) throw new AppError(400, "Selected farm is not available in this workspace");
}
async function checkReorder(tx, req, item) {
  const low = lowStock(item);
  if (low && !item.lowStockAlertActive) {
    const members = await tx.membership.findMany({ where: {
      organizationId: req.auth.organizationId, role: { in: managers }, user: { deletedAt: null, isPlatformAdmin: false }
    }, select: { userId: true } });
    if (members.length) await tx.notification.createMany({ data: members.map(({ userId }) => ({
      organizationId: req.auth.organizationId, userId, inventoryItemId: item.id,
      type: "INVENTORY_LOW_STOCK",
      message: `${item.name}: ${item.quantity} ${item.unit} remaining (reorder level ${item.reorderLevel}). Review stock and plan a reorder.`
    })) });
  }
  if (low !== item.lowStockAlertActive) await tx.inventoryItem.update({ where: { id: item.id }, data: { lowStockAlertActive: low } });
}
function validTime(time, since) {
  if (time > new Date() || time < since) throw new AppError(400, "Observation must be between the item's creation and now");
}
const querySchema = z.object({
  category: z.enum(categories).optional(), farmId: z.uuid().optional(),
  trackingMode: z.enum(["BATCH", "INDIVIDUAL"]).optional(),
  search: z.string().trim().max(200).optional(), lowStock: z.enum(["true", "false"]).optional()
}).strict();
router.get("/", async (req, res, next) => {
  try {
    const { search, lowStock: low, ...filters } = querySchema.parse(req.query);
    const records = await prisma.inventoryItem.findMany({
      where: { ...scope(req), ...filters, ...(search ? { OR: ["name", "sku", "serialNumber"].map((key) => ({ [key]: { contains: search, mode: "insensitive" } })) } : {}) },
      include, orderBy: [{ category: "asc" }, { name: "asc" }, { id: "asc" }]
    });
    const data = records.filter((item) => low === undefined || lowStock(item) === (low === "true")).map(publicItem);
    res.json({ success: true, data, meta: { total: data.length, lowStock: data.filter((item) => item.lowStock).length } });
  } catch (error) { next(error); }
});
router.get("/items/:id", async (req, res, next) => {
  try { res.json({ success: true, data: publicItem(await findItem(prisma, req, z.uuid().parse(req.params.id))) }); }
  catch (error) { next(error); }
});
router.post("/items", authorize(...managers), async (req, res, next) => {
  try {
    const payload = itemSchema.parse(req.body);
    const item = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const { requestId, ...data } = payload;
      if (requestId) {
        const existing = await tx.inventoryItem.findFirst({ where: { organizationId: req.auth.organizationId, creationRequestId: requestId } });
        if (existing) {
          const same = Object.entries(data).every(([key, value]) => ["quantity", "reorderLevel"].includes(key) ? existing[key].eq(value) : (existing[key] ?? null) === (value ?? null));
          if (existing.deletedAt || existing.createdBy !== req.auth.userId || !same) throw new AppError(409, "Request ID was already used; refresh inventory");
          return existing;
        }
      }
      await validateFarm(tx, req, data.farmId);
      const now = new Date();
      const created = await tx.inventoryItem.create({ data: {
        ...data, organizationId: req.auth.organizationId, createdBy: req.auth.userId, creationRequestId: requestId,
        ...(data.trackingMode === "INDIVIDUAL" ? { assetCondition: "WORKING", conditionObservedAt: now } : {})
      } });
      if (data.quantity > 0) await tx.stockMovement.create({ data: {
        organizationId: req.auth.organizationId, itemId: created.id, type: "IN", quantity: data.quantity,
        balanceAfter: data.quantity, occurredAt: created.createdAt, notes: "Opening stock", createdBy: req.auth.userId
      } });
      await checkReorder(tx, req, created);
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "CREATE", entity: "InventoryItem", entityId: created.id }, tx);
      return created;
    });
    res.status(201).json({ success: true, message: "Inventory item created", data: publicItem(item) });
  } catch (error) { next(error); }
});
router.patch("/items/:id", authorize(...managers), async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.id);
    const payload = itemFields.partial().parse(req.body);
    if (!Object.keys(payload).length) throw new AppError(400, "Provide at least one field to update");
    const item = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const existing = await findItem(tx, req, id);
      if (["unit", "category", "trackingMode"].some((key) => Object.hasOwn(payload, key) && payload[key] !== existing[key])) throw new AppError(409, "Unit, category and tracking mode are fixed; create a separate item instead");
      if (existing.trackingMode === "INDIVIDUAL" && ((Object.hasOwn(payload, "sku") && !payload.sku) || (payload.reorderLevel !== undefined && payload.reorderLevel !== 0))) throw new AppError(400, "Individual equipment requires an asset ID and reorder level 0");
      if (existing.trackingMode === "BATCH" && payload.serialNumber) throw new AppError(400, "Serial number applies only to individual equipment");
      if (Object.hasOwn(payload, "farmId") && payload.farmId !== existing.farmId) await validateFarm(tx, req, payload.farmId);
      const updated = await tx.inventoryItem.update({ where: { id }, data: payload, include });
      await checkReorder(tx, req, updated);
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "UPDATE", entity: "InventoryItem", entityId: id }, tx);
      return updated;
    });
    res.json({ success: true, message: "Inventory item updated", data: publicItem(item) });
  } catch (error) { next(error); }
});
router.delete("/items/:id", authorize(...managers), async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.id);
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const item = await findItem(tx, req, id);
      if (!item.quantity.isZero()) throw new AppError(409, "Issue or reconcile remaining stock to zero; retire individual equipment before archiving");
      await tx.inventoryItem.update({ where: { id }, data: { deletedAt: new Date() } });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "ARCHIVE", entity: "InventoryItem", entityId: id }, tx);
    });
    res.json({ success: true, message: "Inventory item archived; history retained" });
  } catch (error) { next(error); }
});
router.get("/items/:id/movements", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.id);
    await findItem(prisma, req, id);
    const data = await prisma.stockMovement.findMany({
      where: { itemId: id, organizationId: req.auth.organizationId },
      include: { creator: { select: { id: true, name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    res.json({ success: true, data: data.map(publicMovement) });
  } catch (error) { next(error); }
});
router.post("/items/:id/movements", authorize(...managers), async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.id);
    const payload = movementSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const item = await findItem(tx, req, id);
      if (item.trackingMode === "INDIVIDUAL") throw new AppError(409, "Use condition/maintenance records to manage individual equipment; retire it to remove it from service");
      if (payload.requestId) {
        const existing = await tx.stockMovement.findUnique({ where: { itemId_requestId: { itemId: id, requestId: payload.requestId } } });
        if (existing) {
          if (existing.createdBy !== req.auth.userId || existing.type !== payload.type || !existing.quantity.eq(payload.quantity) ||
            (existing.reference || "") !== (payload.reference || "") || (existing.notes || "") !== (payload.notes || "") ||
            (existing.unitCost === null ? payload.unitCost !== undefined : !existing.unitCost.eq(payload.unitCost ?? -1)) ||
            (req.body.occurredAt !== undefined && existing.occurredAt.getTime() !== payload.occurredAt.getTime())) throw new AppError(409, "Request ID has already been used for a different movement");
          return existing;
        }
      }
      validTime(payload.occurredAt, item.createdAt);
      const amount = new Prisma.Decimal(payload.quantity);
      const balance = payload.type === "ADJUSTMENT" ? amount : payload.type === "IN" ? item.quantity.plus(amount) : item.quantity.minus(amount);
      if (balance.isNegative()) throw new AppError(409, `Insufficient stock. ${item.quantity} ${item.unit} currently available.`);
      if (balance.gt(1000000000)) throw new AppError(400, "Stock balance exceeds the supported maximum");
      const updated = await tx.inventoryItem.update({ where: { id }, data: { quantity: balance } });
      const movement = await tx.stockMovement.create({ data: {
        ...payload, organizationId: req.auth.organizationId, itemId: id,
        balanceAfter: balance, createdBy: req.auth.userId
      } });
      await checkReorder(tx, req, updated);
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: payload.type, entity: "StockMovement", entityId: movement.id }, tx);
      return movement;
    });
    res.status(201).json({ success: true, message: payload.type === "ADJUSTMENT" ? "Physical stock balance reconciled" : `Stock ${payload.type === "IN" ? "received" : "issued"}`, data: publicMovement(result) });
  } catch (error) { next(error); }
});
router.get("/items/:id/asset-events", async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.id);
    const item = await findItem(prisma, req, id);
    if (item.trackingMode !== "INDIVIDUAL") throw new AppError(409, "Maintenance history applies only to individual equipment");
    const data = await prisma.inventoryAssetEvent.findMany({ where: { itemId: id, organizationId: req.auth.organizationId }, orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }] });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});
router.post("/items/:id/asset-events", authorize(...managers), async (req, res, next) => {
  try {
    const id = z.uuid().parse(req.params.id);
    const payload = assetEventSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const item = await findItem(tx, req, id);
      if (item.trackingMode !== "INDIVIDUAL") throw new AppError(409, "Maintenance history applies only to individual equipment");
      const existing = await tx.inventoryAssetEvent.findUnique({ where: { itemId_requestId: { itemId: id, requestId: payload.requestId } } });
      if (existing) {
        if (existing.recordedBy !== req.auth.userId || existing.type !== payload.type || existing.condition !== payload.condition ||
          existing.notes !== payload.notes || existing.observedAt.getTime() !== payload.observedAt.getTime() ||
          (existing.cost === null ? payload.cost !== undefined : !existing.cost.eq(payload.cost ?? -1)) ||
          (existing.nextMaintenanceDate?.getTime() ?? null) !== (payload.nextMaintenanceDate?.getTime() ?? null)) throw new AppError(409, "Request ID has already been used for a different equipment record");
        return existing;
      }
      if (item.assetCondition === "RETIRED") throw new AppError(409, "Retired equipment cannot be returned to service");
      validTime(payload.observedAt, item.createdAt);
      if (payload.condition === "RETIRED" && payload.observedAt < item.conditionObservedAt) throw new AppError(409, "Retirement cannot precede the latest condition observation");
      const event = await tx.inventoryAssetEvent.create({ data: { ...payload, organizationId: req.auth.organizationId, itemId: id, recordedBy: req.auth.userId } });
      if (!item.conditionObservedAt || payload.observedAt >= item.conditionObservedAt) await tx.inventoryItem.update({ where: { id }, data: {
        assetCondition: payload.condition, conditionObservedAt: payload.observedAt,
        ...(Object.hasOwn(payload, "nextMaintenanceDate") ? { nextMaintenanceDate: payload.nextMaintenanceDate } : {}),
        ...(payload.condition === "RETIRED" ? { quantity: 0, nextMaintenanceDate: null } : {})
      } });
      if (payload.condition === "RETIRED") await tx.stockMovement.create({ data: {
        organizationId: req.auth.organizationId, itemId: id, type: "OUT", quantity: 1,
        balanceAfter: 0, occurredAt: payload.observedAt, notes: `Equipment retired: ${payload.notes}`, createdBy: req.auth.userId
      } });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: payload.type, entity: "InventoryAssetEvent", entityId: event.id }, tx);
      return event;
    });
    res.status(201).json({ success: true, message: "Equipment record saved; history retained", data: result });
  } catch (error) { next(error); }
});
export default router;
