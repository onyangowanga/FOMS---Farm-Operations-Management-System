import { Router } from "express";
import { z } from "zod";
import { prisma, lockOrganization } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";
import { farmSchema, blockSchema, validateCoordinates } from "./structure.validation.js";

async function audit(tx, req, action, entity, entityId) {
  await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action, entity, entityId }, tx);
}

async function validateBlockParent(tx, organizationId, record) {
  const farm = await tx.farm.findFirst({
    where: { id: record.farmId, organizationId, deletedAt: null }
  });
  if (!farm) throw new AppError(400, "The selected farm is not available in this workspace");
}

export function createStructureRouter(kind) {
  const router = Router();
  const isFarm = kind === "farms";
  const delegate = isFarm ? "farm" : "block";
  const entity = isFarm ? "Farm" : "Block";
  const schema = isFarm ? farmSchema : blockSchema;

  router.get("/", async (req, res, next) => {
    try {
      const query = z.object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        farmId: z.uuid().optional()
      }).parse(req.query);
      const where = {
        organizationId: req.auth.organizationId,
        deletedAt: null,
        ...(!isFarm ? { farm: { deletedAt: null }, ...(query.farmId ? { farmId: query.farmId } : {}) } : {})
      };
      const [items, total] = await prisma.$transaction([
        prisma[delegate].findMany({
          where, orderBy: [{ name: "asc" }, { id: "asc" }],
          skip: (query.page - 1) * query.limit, take: query.limit,
          ...(!isFarm ? { include: { farm: { select: { id: true, name: true } } } } : {})
        }),
        prisma[delegate].count({ where })
      ]);
      res.json({ success: true, data: items, meta: { ...query, total } });
    } catch (error) { next(error); }
  });

  router.post("/", authorize("OWNER", "MANAGER"), async (req, res, next) => {
    try {
      const payload = schema.parse(req.body);
      validateCoordinates(payload);
      const created = await prisma.$transaction(async (tx) => {
        await lockOrganization(tx, req.auth.organizationId);
        if (!isFarm) await validateBlockParent(tx, req.auth.organizationId, payload);
        const record = await tx[delegate].create({
          data: { ...payload, organizationId: req.auth.organizationId, createdBy: req.auth.userId }
        });
        await audit(tx, req, "CREATE", entity, record.id);
        return record;
      });
      res.status(201).json({ success: true, message: `${entity} created`, data: created });
    } catch (error) { next(error); }
  });

  router.patch("/:id", authorize("OWNER", "MANAGER"), async (req, res, next) => {
    try {
      const id = z.uuid().parse(req.params.id);
      const payload = schema.partial().parse(req.body);
      if (!Object.keys(payload).length) throw new AppError(400, "Provide at least one field to update");
      const updated = await prisma.$transaction(async (tx) => {
        await lockOrganization(tx, req.auth.organizationId);
        const existing = await tx[delegate].findFirst({
          where: { id, organizationId: req.auth.organizationId, deletedAt: null }
        });
        if (!existing) throw new AppError(404, `${entity} was not found`);
        const merged = { ...existing, ...payload };
        validateCoordinates(merged);
        if (!isFarm) {
          await validateBlockParent(tx, req.auth.organizationId, merged);
          if (payload.farmId && payload.farmId !== existing.farmId) {
            throw new AppError(409, "A block cannot be moved to another farm. Create a new block there instead.");
          }
        }
        const record = await tx[delegate].update({ where: { id }, data: payload });
        await audit(tx, req, "UPDATE", entity, id);
        return record;
      });
      res.json({ success: true, message: `${entity} updated`, data: updated });
    } catch (error) { next(error); }
  });

  router.delete("/:id", authorize("OWNER", "MANAGER"), async (req, res, next) => {
    try {
      const id = z.uuid().parse(req.params.id);
      await prisma.$transaction(async (tx) => {
        await lockOrganization(tx, req.auth.organizationId);
        const where = { id, organizationId: req.auth.organizationId, deletedAt: null };
        const existing = await tx[delegate].findFirst({ where });
        if (!existing) throw new AppError(404, `${entity} was not found`);
        const relatedWhere = {
          organizationId: req.auth.organizationId, deletedAt: null,
          ...(isFarm ? { farmId: id } : { blockId: id })
        };
        const children = isFarm
          ? ["block", "cropCycle", "livestock", "task", "journalEntry", "expense", "inventoryItem", "buyer", "sale", "document"]
          : ["cropCycle", "journalEntry"];
        const counts = await Promise.all(children.map((child) => tx[child].count({ where: relatedWhere })));
        if (counts.some((count) => count > 0)) {
          throw new AppError(409, `Archive or unlink active records belonging to this ${entity.toLowerCase()} first.`);
        }
        await tx[delegate].update({ where: { id }, data: { deletedAt: new Date() } });
        await audit(tx, req, "DELETE", entity, id);
      });
      res.json({ success: true, message: `${entity} archived` });
    } catch (error) { next(error); }
  });
  return router;
}

export const organizationRouter = Router();
organizationRouter.get("/", async (req, res, next) => {
  try {
    const organization = await prisma.organization.findFirst({
      where: { id: req.auth.organizationId, deletedAt: null },
      select: {
        id: true, name: true, slug: true,
        farms: {
          where: { deletedAt: null }, orderBy: [{ name: "asc" }, { id: "asc" }],
          select: {
            id: true, name: true, location: true, acreage: true, latitude: true, longitude: true,
            blocks: {
              where: { deletedAt: null }, orderBy: [{ name: "asc" }, { id: "asc" }],
              select: { id: true, name: true, acreage: true, latitude: true, longitude: true, currentUse: true, soilType: true }
            }
          }
        }
      }
    });
    if (!organization) throw new AppError(404, "Workspace was not found");
    res.json({ success: true, data: organization });
  } catch (error) { next(error); }
});
organizationRouter.patch("/", authorize("OWNER"), async (req, res, next) => {
  try {
    const payload = z.object({ name: z.string().trim().min(2).max(120) }).strict().parse(req.body);
    const organization = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const updated = await tx.organization.update({
        where: { id: req.auth.organizationId }, data: payload, select: { id: true, name: true }
      });
      await audit(tx, req, "UPDATE", "Organization", updated.id);
      return updated;
    });
    res.json({ success: true, message: "Workspace updated", data: organization });
  } catch (error) { next(error); }
});
