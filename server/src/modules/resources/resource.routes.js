import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";

const nullableText = z.string().trim().max(2000).nullable().optional();
const nullableDate = z.coerce.date().nullable().optional();
const nullableNumber = z.coerce.number().finite().nonnegative().nullable().optional();
const uuid = z.uuid();
const schemas = {
  farms: z.object({ name: z.string().trim().min(2).max(120), location: nullableText, acreage: nullableNumber, description: nullableText }),
  blocks: z.object({ farmId: uuid, name: z.string().trim().min(1).max(120), acreage: nullableNumber, latitude: z.coerce.number().min(-90).max(90).nullable().optional(), longitude: z.coerce.number().min(-180).max(180).nullable().optional(), currentUse: nullableText, soilType: nullableText }),
  crops: z.object({ farmId: uuid, blockId: uuid.nullable().optional(), cropName: z.string().trim().min(1).max(120), variety: nullableText, status: z.enum(["PLANNED", "GROWING", "HARVESTED", "CANCELLED"]).optional(), acreage: nullableNumber, expectedYield: nullableNumber, nurseryDate: nullableDate, plantingDate: nullableDate, expectedHarvest: nullableDate, notes: nullableText }),
  livestock: z.object({ farmId: uuid, species: z.enum(["GOAT", "SHEEP", "POULTRY"]), identifier: nullableText, breed: nullableText, quantity: z.coerce.number().int().min(1).max(100000).optional(), birthDate: nullableDate, weightKg: nullableNumber, healthStatus: z.enum(["HEALTHY", "UNDER_TREATMENT", "SICK", "DECEASED"]).optional(), lastVaccinated: nullableDate, notes: nullableText }),
  tasks: z.object({ farmId: uuid.nullable().optional(), title: z.string().trim().min(2).max(160), description: nullableText, category: nullableText, status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "APPROVED"]).optional(), priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(), dueDate: nullableDate, assignedTo: uuid.nullable().optional(), evidenceUrl: z.string().url().nullable().optional() }),
  journal: z.object({ farmId: uuid.nullable().optional(), blockId: uuid.nullable().optional(), title: z.string().trim().min(2).max(160), category: z.string().trim().min(2).max(50).optional(), body: z.string().trim().min(2).max(10000), weather: nullableText, incident: nullableText, cost: z.coerce.number().nonnegative().optional(), photoUrl: z.string().url().nullable().optional(), observedAt: nullableDate }),
  expenses: z.object({ farmId: uuid.nullable().optional(), description: z.string().trim().min(2).max(200), category: z.enum(["LABOR", "SEED", "FERTILIZER", "CHEMICALS", "FEED", "TRANSPORT", "VETERINARY", "FUEL", "REPAIRS", "OTHER"]), supplier: nullableText, amount: z.coerce.number().positive(), currency: z.string().trim().length(3).toUpperCase().optional(), paymentMethod: nullableText, expenseDate: nullableDate, notes: nullableText })
};

const config = {
  farms: { delegate: "farm", entity: "Farm", creator: "createdBy", roles: ["OWNER", "MANAGER"], readRoles: ["OWNER", "MANAGER", "AGRONOMIST", "WORKER"] },
  blocks: { delegate: "block", entity: "Block", creator: "createdBy", roles: ["OWNER", "MANAGER"], readRoles: ["OWNER", "MANAGER", "AGRONOMIST", "WORKER"] },
  crops: { delegate: "cropCycle", entity: "CropCycle", creator: "createdBy", roles: ["OWNER", "MANAGER", "AGRONOMIST"], readRoles: ["OWNER", "MANAGER", "AGRONOMIST", "WORKER"] },
  livestock: { delegate: "livestock", entity: "Livestock", creator: "createdBy", roles: ["OWNER", "MANAGER"], readRoles: ["OWNER", "MANAGER", "WORKER"] },
  tasks: { delegate: "task", entity: "Task", creator: "createdBy", roles: ["OWNER", "MANAGER"], readRoles: ["OWNER", "MANAGER", "AGRONOMIST", "WORKER"] },
  journal: { delegate: "journalEntry", entity: "JournalEntry", creator: "authorId", roles: ["OWNER", "MANAGER", "AGRONOMIST", "WORKER"], readRoles: ["OWNER", "MANAGER", "AGRONOMIST", "WORKER"] },
  expenses: { delegate: "expense", entity: "Expense", creator: "createdBy", roles: ["OWNER", "MANAGER"], readRoles: ["OWNER", "MANAGER"] }
};

function model(path) {
  const resource = config[path];
  if (!resource) throw new AppError(404, "Resource was not found");
  return { ...resource, db: prisma[resource.delegate], schema: schemas[path] };
}

async function assertRelatedTenant(resource, organizationId, data) {
  const checks = [];
  if (data.farmId) checks.push(prisma.farm.findFirst({ where: { id: data.farmId, organizationId, deletedAt: null }, select: { id: true } }));
  if (data.blockId) checks.push(prisma.block.findFirst({ where: { id: data.blockId, organizationId, deletedAt: null }, select: { id: true } }));
  if (data.assignedTo) checks.push(prisma.membership.findFirst({ where: { userId: data.assignedTo, organizationId }, select: { id: true } }));
  const found = await Promise.all(checks);
  if (found.some((record) => !record)) throw new AppError(400, "A selected farm, block, or assignee is not available in this workspace");
  if (resource.entity === "Block" && data.farmId) {
    const parent = await prisma.farm.findFirst({ where: { id: data.farmId, organizationId, deletedAt: null }, select: { id: true } });
    if (!parent) throw new AppError(400, "The selected farm is not available in this workspace");
  }
}

export function createResourceRouter(path) {
  const router = Router();
  const resource = model(path);
  router.use((req, _res, next) => {
    req.resource = resource;
    next();
  });
  router.get("/", authorize(...resource.readRoles), async (req, res, next) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
      const where = { organizationId: req.auth.organizationId, deletedAt: null };
      if (resource.entity === "Task" && req.auth.role === "WORKER") where.assignedTo = req.auth.userId;
      const [items, total] = await Promise.all([
        resource.db.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit
        }),
        resource.db.count({ where })
      ]);
      res.json({ success: true, data: items, meta: { page, limit, total } });
    } catch (error) { next(error); }
  });

  router.post("/", authorize(...resource.roles), async (req, res, next) => {
    try {
      const payload = resource.schema.parse(req.body);
      await assertRelatedTenant(resource, req.auth.organizationId, payload);
      const data = { ...payload, organizationId: req.auth.organizationId };
      if (resource.creator) data[resource.creator] = req.auth.userId;
      const created = await resource.db.create({ data });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "CREATE", entity: resource.entity, entityId: created.id });
      res.status(201).json({ success: true, message: `${resource.entity} created`, data: created });
    } catch (error) { next(error); }
  });

  if (resource.entity === "Expense") {
    router.post("/:id/approve", authorize("OWNER"), async (req, res, next) => {
      try {
        const id = uuid.parse(req.params.id);
        const updated = await resource.db.updateMany({
          where: { id, organizationId: req.auth.organizationId, deletedAt: null, approvedAt: null },
          data: { approvedAt: new Date() }
        });
        if (updated.count === 0) throw new AppError(404, "An unapproved expense was not found");
        const expense = await resource.db.findFirst({ where: { id, organizationId: req.auth.organizationId } });
        await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "APPROVE", entity: resource.entity, entityId: id });
        res.json({ success: true, message: "Expense approved", data: expense });
      } catch (error) { next(error); }
    });
  }

  router.patch("/:id", async (req, res, next) => {
    try {
      if (!resource.roles.includes(req.auth.role) && !(resource.entity === "Task" && req.auth.role === "WORKER")) {
        throw new AppError(403, "You do not have permission to perform this action");
      }
      const id = uuid.parse(req.params.id);
      const payload = resource.schema.partial().parse(req.body);
      if (Object.keys(payload).length === 0) throw new AppError(400, "Provide at least one field to update");
      if (resource.entity === "Task" && req.auth.role === "WORKER") {
        const allowed = new Set(["status", "evidenceUrl"]);
        if (Object.keys(payload).some((key) => !allowed.has(key)) || !["IN_PROGRESS", "COMPLETED"].includes(payload.status)) {
          throw new AppError(403, "Workers can only update the status of assigned tasks");
        }
      }
      await assertRelatedTenant(resource, req.auth.organizationId, payload);
      const where = { id, organizationId: req.auth.organizationId, deletedAt: null };
      if (resource.entity === "Task" && req.auth.role === "WORKER") {
        where.assignedTo = req.auth.userId;
        where.status = { in: ["PENDING", "IN_PROGRESS"] };
      }
      const updateData = {
        ...payload,
        ...(resource.entity === "Task" && payload.status === "COMPLETED" ? { completedAt: new Date() } : {})
      };
      const result = await resource.db.updateMany({
        where,
        data: updateData
      });
      if (result.count === 0) throw new AppError(404, `${resource.entity} was not found`);
      const updated = await resource.db.findFirst({ where: { id, organizationId: req.auth.organizationId } });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "UPDATE", entity: resource.entity, entityId: id });
      res.json({ success: true, message: `${resource.entity} updated`, data: updated });
    } catch (error) { next(error); }
  });

  router.delete("/:id", authorize(...resource.roles), async (req, res, next) => {
    try {
      const id = uuid.parse(req.params.id);
      const result = await resource.db.updateMany({
        where: { id, organizationId: req.auth.organizationId, deletedAt: null },
        data: { deletedAt: new Date() }
      });
      if (result.count === 0) throw new AppError(404, `${resource.entity} was not found`);
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "DELETE", entity: resource.entity, entityId: id });
      res.json({ success: true, message: `${resource.entity} archived` });
    } catch (error) { next(error); }
  });
  return router;
}
