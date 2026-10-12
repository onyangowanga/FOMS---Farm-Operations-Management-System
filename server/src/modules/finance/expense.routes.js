import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma, lockOrganization } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";
import { storeUpload, readUpload, removeUpload } from "../../shared/uploads.js";
import { currency, money, queryFields, validRange, filters, scope, relatedFarm, replay, requestHash, expenseView } from "./finance.shared.js";

const router = Router();
router.use(authorize("OWNER", "MANAGER"));
const categories = ["LABOR", "SEED", "FERTILIZER", "CHEMICALS", "FEED", "TRANSPORT", "VETERINARY", "FUEL", "REPAIRS", "OTHER"];
const text = z.string().trim().max(2000).nullable().optional();
const fields = z.object({
  farmId: z.uuid().nullable().optional(), description: z.string().trim().min(2).max(200),
  category: z.enum(categories), supplier: text, amount: money, currency: currency.optional(),
  paymentMethod: text, expenseDate: z.coerce.date().optional(), notes: text
}).strict();
const createSchema = fields.extend({ currency: currency.default("KES"), requestId: z.uuid().optional() });
const querySchema = z.object({
  ...queryFields, category: z.enum(categories).optional(), approval: z.enum(["PENDING", "APPROVED"]).optional(),
  page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(50)
}).strict().refine(validRange, { message: "Start date must not follow end date" });
const include = { farm: { select: { id: true, name: true } }, creator: { select: { id: true, name: true } } };
async function find(tx, req) {
  const record = await tx.expense.findFirst({ where: scope(req, z.uuid().parse(req.params.id)), include });
  if (!record) throw new AppError(404, "Expense was not found");
  return record;
}
function editable(record) {
  if (record.approvedAt) throw new AppError(409, "Approved expenses are locked to preserve financial summaries");
}
router.get("/", async (req, res, next) => {
  try {
    const query = querySchema.parse(req.query);
    const where = {
      ...scope(req), ...filters(query, "expenseDate"), ...(query.category ? { category: query.category } : {}),
      ...(query.approval ? { approvedAt: query.approval === "PENDING" ? null : { not: null } } : {}),
      ...(query.search ? { OR: ["description", "supplier"].map((key) => ({ [key]: { contains: query.search, mode: "insensitive" } })) } : {})
    };
    const [records, total] = await prisma.$transaction([
      prisma.expense.findMany({ where, include, orderBy: [{ expenseDate: "desc" }, { id: "asc" }], take: query.limit, skip: (query.page - 1) * query.limit }),
      prisma.expense.count({ where })
    ]);
    res.json({ success: true, data: records.map(expenseView), meta: { ...query, total } });
  } catch (error) { next(error); }
});
router.get("/:id", async (req, res, next) => {
  try { res.json({ success: true, data: expenseView(await find(prisma, req)) }); }
  catch (error) { next(error); }
});
router.post("/", async (req, res, next) => {
  try {
    const payload = createSchema.parse(req.body);
    const record = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const existing = await replay(tx, "expense", req, payload, "createdBy", include);
      if (existing) return existing;
      await relatedFarm(tx, req, payload.farmId);
      const created = await tx.expense.create({ data: { ...payload, requestHash: requestHash(payload), organizationId: req.auth.organizationId, createdBy: req.auth.userId }, include });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "CREATE", entity: "Expense", entityId: created.id }, tx);
      return created;
    });
    res.status(201).json({ success: true, message: "Expense recorded; awaiting owner approval", data: expenseView(record) });
  } catch (error) { next(error); }
});
router.patch("/:id", async (req, res, next) => {
  try {
    const payload = fields.partial().parse(req.body);
    if (!Object.keys(payload).length) throw new AppError(400, "Provide at least one field to update");
    const record = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const existing = await find(tx, req);
      editable(existing);
      if (Object.hasOwn(payload, "farmId") && payload.farmId !== existing.farmId) await relatedFarm(tx, req, payload.farmId);
      const updated = await tx.expense.update({ where: { id: existing.id }, data: payload, include });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "UPDATE", entity: "Expense", entityId: existing.id }, tx);
      return updated;
    });
    res.json({ success: true, message: "Pending expense updated", data: expenseView(record) });
  } catch (error) { next(error); }
});
router.post("/:id/approve", authorize("OWNER"), async (req, res, next) => {
  try {
    z.object({}).strict().parse(req.body);
    const record = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const existing = await find(tx, req);
      if (existing.approvedAt) return existing;
      const updated = await tx.expense.update({ where: { id: existing.id }, data: { approvedAt: new Date(), approvedBy: req.auth.userId }, include });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "APPROVE", entity: "Expense", entityId: existing.id }, tx);
      return updated;
    });
    res.json({ success: true, message: "Expense approved and included in profit", data: expenseView(record) });
  } catch (error) { next(error); }
});
router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const record = await find(tx, req);
      editable(record);
      await tx.expense.update({ where: { id: record.id }, data: { deletedAt: new Date() } });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "ARCHIVE", entity: "Expense", entityId: record.id }, tx);
    });
    res.json({ success: true, message: "Pending expense archived; history retained" });
  } catch (error) { next(error); }
});
const attachmentView = ({ storageName, ...record }) => ({ ...record, downloadPath: `/api/v1/expenses/${record.expenseId}/attachments/${record.id}/download` });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 } });
router.get("/:id/attachments", async (req, res, next) => {
  try {
    const record = await find(prisma, req);
    const data = await prisma.expenseAttachment.findMany({ where: { expenseId: record.id, organizationId: req.auth.organizationId, deletedAt: null }, orderBy: { createdAt: "asc" } });
    res.json({ success: true, data: data.map(attachmentView) });
  } catch (error) { next(error); }
});
router.post("/:id/attachments", upload.single("file"), async (req, res, next) => {
  let savedPath;
  try {
    if (!req.file) throw new AppError(400, "Select a receipt photo or PDF");
    editable(await find(prisma, req));
    const stored = await storeUpload(req.auth.organizationId, req.file);
    savedPath = stored.savedPath;
    const record = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const expense = await find(tx, req);
      editable(expense);
      if (await tx.expenseAttachment.count({ where: { expenseId: expense.id, deletedAt: null } }) >= 10) throw new AppError(409, "An expense allows up to 10 active attachments");
      const file = await tx.expenseAttachment.create({ data: {
        id: stored.id, expenseId: expense.id, organizationId: req.auth.organizationId,
        storageName: stored.storageName, originalName: stored.originalName, mimeType: stored.mimeType,
        sizeBytes: req.file.size, uploadedBy: req.auth.userId
      } });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "ATTACH", entity: "Expense", entityId: expense.id }, tx);
      return file;
    });
    savedPath = null;
    res.status(201).json({ success: true, message: "Expense receipt attached", data: attachmentView(record) });
  } catch (error) { if (savedPath) await removeUpload(savedPath); next(error); }
});
router.get("/:id/attachments/:fileId/download", async (req, res, next) => {
  try {
    const expense = await find(prisma, req);
    const record = await prisma.expenseAttachment.findFirst({ where: { id: z.uuid().parse(req.params.fileId), expenseId: expense.id, organizationId: req.auth.organizationId, deletedAt: null } });
    if (!record) throw new AppError(404, "Receipt was not found");
    const content = await readUpload(record.storageName, req.auth.organizationId);
    res.set({ "Content-Type": record.mimeType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(record.originalName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }).send(content);
  } catch (error) { next(error); }
});
router.delete("/:id/attachments/:fileId", async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const expense = await find(tx, req);
      editable(expense);
      const updated = await tx.expenseAttachment.updateMany({ where: { id: z.uuid().parse(req.params.fileId), expenseId: expense.id, organizationId: req.auth.organizationId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (!updated.count) throw new AppError(404, "Receipt was not found");
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "REMOVE_ATTACHMENT", entity: "Expense", entityId: expense.id }, tx);
    });
    res.json({ success: true, message: "Receipt removed; history retained" });
  } catch (error) { next(error); }
});
export default router;
