import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";

const router = Router();
const itemSchema = z.object({
  farmId: z.uuid().nullable().optional(),
  name: z.string().trim().min(2).max(120),
  sku: z.string().trim().max(80).nullable().optional(),
  category: z.enum(["SEED", "FERTILIZER", "CHEMICAL", "FEED", "VACCINE", "SUPPLEMENT", "ASSET", "OTHER"]),
  unit: z.string().trim().min(1).max(30),
  quantity: z.coerce.number().finite().nonnegative().default(0),
  reorderLevel: z.coerce.number().finite().nonnegative().default(0),
  notes: z.string().trim().max(2000).nullable().optional()
});
const movementSchema = z.object({
  type: z.enum(["IN", "OUT"]),
  quantity: z.coerce.number().finite().positive(),
  unitCost: z.coerce.number().finite().nonnegative().optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional()
});
const itemWhere = (organizationId) => ({ organizationId, deletedAt: null });

router.get("/", async (req, res, next) => {
  try {
    const items = await prisma.inventoryItem.findMany({
      where: itemWhere(req.auth.organizationId),
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: { farm: { select: { id: true, name: true } }, _count: { select: { movements: true } } }
    });
    res.json({
      success: true,
      data: items,
      meta: { total: items.length, lowStock: items.filter((item) => item.quantity <= item.reorderLevel).length }
    });
  } catch (error) { next(error); }
});

router.post("/items", authorize("OWNER", "MANAGER"), async (req, res, next) => {
  try {
    const payload = itemSchema.parse(req.body);
    if (payload.farmId && !(await prisma.farm.findFirst({ where: { id: payload.farmId, ...itemWhere(req.auth.organizationId) }, select: { id: true } }))) {
      throw new AppError(400, "The selected farm is not available in this workspace");
    }
    const { quantity, ...itemData } = payload;
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.inventoryItem.create({
        data: { ...itemData, quantity, organizationId: req.auth.organizationId, createdBy: req.auth.userId }
      });
      if (quantity > 0) {
        await tx.stockMovement.create({
          data: { organizationId: req.auth.organizationId, itemId: created.id, type: "IN", quantity, notes: "Opening stock", createdBy: req.auth.userId }
        });
      }
      return created;
    });
    await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "CREATE", entity: "InventoryItem", entityId: item.id });
    res.status(201).json({ success: true, message: "Inventory item created", data: item });
  } catch (error) { next(error); }
});

router.post("/items/:id/movements", authorize("OWNER", "MANAGER"), async (req, res, next) => {
  try {
    const itemId = z.uuid().parse(req.params.id);
    const payload = movementSchema.parse(req.body);
    const movement = await prisma.$transaction(async (tx) => {
      const where = { id: itemId, ...itemWhere(req.auth.organizationId) };
      const item = await tx.inventoryItem.findFirst({ where });
      if (!item) throw new AppError(404, "Inventory item was not found");
      if (payload.type === "OUT" && item.quantity < payload.quantity) {
        throw new AppError(409, `Insufficient stock. ${item.quantity} ${item.unit} currently available.`);
      }
      const adjustment = payload.type === "IN" ? payload.quantity : -payload.quantity;
      const updated = await tx.inventoryItem.updateMany({
        where: {
          ...where,
          ...(payload.type === "OUT" ? { quantity: { gte: payload.quantity } } : {})
        },
        data: { quantity: { increment: adjustment } }
      });
      if (updated.count === 0) throw new AppError(409, "Stock changed during this request; refresh and try again");
      return tx.stockMovement.create({
        data: {
          organizationId: req.auth.organizationId,
          itemId,
          type: payload.type,
          quantity: payload.quantity,
          unitCost: payload.unitCost,
          reference: payload.reference,
          notes: payload.notes,
          createdBy: req.auth.userId
        },
        include: { item: true }
      });
    });
    await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: payload.type, entity: "StockMovement", entityId: movement.id });
    res.status(201).json({ success: true, message: `Stock ${payload.type === "IN" ? "received" : "issued"}`, data: movement });
  } catch (error) { next(error); }
});

router.get("/items/:id/movements", async (req, res, next) => {
  try {
    const itemId = z.uuid().parse(req.params.id);
    const item = await prisma.inventoryItem.findFirst({
      where: { id: itemId, ...itemWhere(req.auth.organizationId) },
      select: { id: true }
    });
    if (!item) throw new AppError(404, "Inventory item was not found");
    const data = await prisma.stockMovement.findMany({
      where: { organizationId: req.auth.organizationId, itemId },
      orderBy: { createdAt: "desc" },
      include: { creator: { select: { id: true, name: true } } }
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

export default router;
