import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, lockOrganization } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";
import { money, quantity, currency, queryFields, validRange, filters, scope, relatedFarm, replay, requestHash, stripReplay, saleView, saleInclude } from "../finance/finance.shared.js";

const router = Router();
router.use(authorize("OWNER", "MANAGER"));
const buyerFields = z.object({
  name: z.string().trim().min(2).max(120), email: z.email().trim().toLowerCase().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional()
}).strict();
const buyerSchema = buyerFields.extend({ farmId: z.uuid().nullable().optional(), address: z.string().trim().max(500).nullable().optional() });
const saleFields = z.object({
  farmId: z.uuid().nullable().optional(), buyerId: z.uuid().nullable().optional(), buyer: buyerFields.optional(),
  product: z.string().trim().min(2).max(160), quantity, unit: z.string().trim().min(1).max(30), unitPrice: money,
  currency: currency.optional(), soldAt: z.coerce.date().optional(), dueDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional()
}).strict();
const createSchema = saleFields.extend({ requestId: z.uuid().optional(), currency: currency.default("KES") });
const paymentSchema = z.object({
  requestId: z.uuid().optional(), amount: money, method: z.enum(["CASH", "MPESA", "BANK_TRANSFER", "CHEQUE", "OTHER"]),
  reference: z.string().trim().max(120).optional(), receivedAt: z.coerce.date().optional()
}).strict();
const livestockInvoiceSchema = z.object({
  requestId: z.uuid().optional(), buyerId: z.uuid().optional(), buyer: buyerFields.optional(),
  unitPrice: money, currency: currency.default("KES"), dueDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional()
}).strict();
const querySchema = z.object({ ...queryFields, status: z.enum(["PAID", "PARTIAL", "UNPAID", "OVERDUE"]).optional() }).strict().refine(validRange, { message: "Start date must not follow end date" });
async function find(tx, req) {
  const record = await tx.sale.findFirst({ where: scope(req, z.uuid().parse(req.params.id)), include: saleInclude });
  if (!record) throw new AppError(404, "Invoice was not found");
  return record;
}
async function relatedBuyer(tx, req, data) {
  if (data.buyerId && data.buyer) throw new AppError(400, "Select an existing buyer or enter a new buyer, not both");
  if (!data.buyerId && !data.buyer) throw new AppError(400, "Select an existing buyer or enter the buyer's details");
  if (data.buyerId && !await tx.buyer.findFirst({ where: scope(req, data.buyerId) })) throw new AppError(400, "Buyer is not available in this workspace");
}
function amounts(data) {
  const unitPrice = new Prisma.Decimal(data.unitPrice);
  const totalAmount = unitPrice.mul(data.quantity).toDecimalPlaces(2);
  if (totalAmount.lte(0) || totalAmount.gt(9999999999.99)) throw new AppError(400, "Invoice total must be between 0.01 and 9,999,999,999.99");
  if (data.dueDate && data.soldAt && data.dueDate < data.soldAt) throw new AppError(400, "Invoice due date cannot precede the sale date");
  return { unitPrice, totalAmount };
}
router.get("/buyers", async (req, res, next) => {
  try {
    const data = await prisma.buyer.findMany({ where: scope(req), orderBy: { name: "asc" }, include: { farm: { select: { id: true, name: true } }, _count: { select: { sales: true } } } });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});
router.post("/buyers", async (req, res, next) => {
  try {
    const payload = buyerSchema.parse(req.body);
    const data = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      await relatedFarm(tx, req, payload.farmId);
      const record = await tx.buyer.create({ data: { ...payload, organizationId: req.auth.organizationId, createdBy: req.auth.userId } });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "CREATE", entity: "Buyer", entityId: record.id }, tx);
      return record;
    });
    res.status(201).json({ success: true, message: "Buyer created", data });
  } catch (error) { next(error); }
});
router.get("/", async (req, res, next) => {
  try {
    const query = querySchema.parse(req.query);
    const records = await prisma.sale.findMany({ where: {
      ...scope(req), ...filters(query, "soldAt"),
      ...(query.search ? { OR: [
        ...["product", "invoiceNumber"].map((key) => ({ [key]: { contains: query.search, mode: "insensitive" } })),
        { buyer: { name: { contains: query.search, mode: "insensitive" } } }
      ] } : {})
    }, include: saleInclude, orderBy: [{ soldAt: "desc" }, { id: "asc" }] });
    const data = records.map(saleView).filter((record) => !query.status || (query.status === "OVERDUE" ? record.balance > 0 && record.dueDate && record.dueDate < new Date() : record.paymentStatus === query.status));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});
router.get("/:id", async (req, res, next) => {
  try { res.json({ success: true, data: saleView(await find(prisma, req)) }); }
  catch (error) { next(error); }
});
router.post("/", async (req, res, next) => {
  try {
    const payload = createSchema.parse(req.body);
    const record = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const existing = await replay(tx, "sale", req, payload, "createdBy", saleInclude);
      if (existing) return existing;
      await relatedFarm(tx, req, payload.farmId);
      await relatedBuyer(tx, req, payload);
      const totals = amounts({ ...payload, soldAt: payload.soldAt || new Date() });
      const buyer = payload.buyerId ? null : await tx.buyer.create({ data: { ...payload.buyer, farmId: payload.farmId, organizationId: req.auth.organizationId, createdBy: req.auth.userId } });
      const { buyer: buyerInput, ...data } = payload;
      const created = await tx.sale.create({ data: {
        ...data, ...totals, requestHash: requestHash(payload), buyerId: payload.buyerId || buyer.id,
        organizationId: req.auth.organizationId, createdBy: req.auth.userId,
        invoiceNumber: `FOMS-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`
      }, include: saleInclude });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "CREATE", entity: "Sale", entityId: created.id }, tx);
      return created;
    });
    res.status(201).json({ success: true, message: `Invoice ${record.invoiceNumber} created`, data: saleView(record) });
  } catch (error) { next(error); }
});
router.post("/livestock-events/:eventId/invoice", async (req, res, next) => {
  try {
    const payload = livestockInvoiceSchema.parse(req.body);
    const eventId = z.uuid().parse(req.params.eventId);
    const sale = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const event = await tx.livestockEvent.findFirst({
        where: { id: eventId, type: "SALE", livestock: { organizationId: req.auth.organizationId, deletedAt: null, farm: { deletedAt: null } } },
        include: { livestock: true, saleInvoice: true }
      });
      if (!event) throw new AppError(404, "Livestock sale event was not found");
      const hashPayload = { ...payload, livestockEventId: event.id };
      const previous = await replay(tx, "sale", req, hashPayload, "createdBy", saleInclude);
      if (previous) {
        if (previous.livestockEventId !== event.id) throw new AppError(409, "Request ID belongs to another sale");
        return previous;
      }
      if (event.saleInvoice) throw new AppError(409, "This livestock sale already has a linked invoice");
      await relatedBuyer(tx, req, payload);
      const farmId = event.livestock.farmId;
      const product = `${event.livestock.species} - ${event.livestock.identifier || "Livestock"}${["POULTRY", "DUCK", "TURKEY", "QUAIL", "GUINEA_FOWL"].includes(event.livestock.species) ? " (birds)" : " (head)"}`;
      const totals = amounts({ unitPrice: payload.unitPrice, quantity: event.quantity, soldAt: event.occurredAt, dueDate: payload.dueDate });
      const buyer = payload.buyerId ? null : await tx.buyer.create({
        data: { ...payload.buyer, farmId, organizationId: req.auth.organizationId, createdBy: req.auth.userId }
      });
      const created = await tx.sale.create({ data: {
        organizationId: req.auth.organizationId, farmId, buyerId: payload.buyerId || buyer.id,
        invoiceNumber: `FOMS-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
        product, quantity: event.quantity, unit: "head", ...totals, currency: payload.currency,
        soldAt: event.occurredAt, dueDate: payload.dueDate, notes: payload.notes || null,
        requestId: payload.requestId, requestHash: requestHash(hashPayload), createdBy: req.auth.userId,
        livestockEventId: event.id
      }, include: saleInclude });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "CREATE", entity: "Sale", entityId: created.id }, tx);
      return created;
    });
    res.status(201).json({ success: true, message: `Invoice ${sale.invoiceNumber} linked to the livestock sale`, data: saleView(sale) });
  } catch (error) { next(error); }
});
router.patch("/:id", async (req, res, next) => {
  try {
    const payload = saleFields.omit({ buyer: true }).partial().parse(req.body);
    if (!Object.keys(payload).length) throw new AppError(400, "Provide at least one field to update");
    const record = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const existing = await find(tx, req);
      if (existing.payments.length) throw new AppError(409, "Invoices with payments are locked");
      if (existing.livestockEventId && ["farmId", "quantity", "soldAt", "product", "unit"].some((field) => payload[field] !== undefined)) {
        throw new AppError(409, "Farm, product, quantity, unit and sale date are fixed by the linked livestock sale event");
      }
      if (Object.hasOwn(payload, "farmId") && payload.farmId !== existing.farmId) await relatedFarm(tx, req, payload.farmId);
      if (Object.hasOwn(payload, "buyerId")) await relatedBuyer(tx, req, payload);
      const updated = await tx.sale.update({ where: { id: existing.id }, data: { ...payload, ...amounts({ ...existing, ...payload }) }, include: saleInclude });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "UPDATE", entity: "Sale", entityId: existing.id }, tx);
      return updated;
    });
    res.json({ success: true, message: "Unpaid invoice updated", data: saleView(record) });
  } catch (error) { next(error); }
});
router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const record = await find(tx, req);
      if (record.payments.length) throw new AppError(409, "Invoices with payments cannot be archived");
      if (record.livestockEventId) throw new AppError(409, "This invoice is linked to an immutable livestock sale event and cannot be archived");
      await tx.sale.update({ where: { id: record.id }, data: { deletedAt: new Date() } });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "ARCHIVE", entity: "Sale", entityId: record.id }, tx);
    });
    res.json({ success: true, message: "Unpaid invoice archived; history retained" });
  } catch (error) { next(error); }
});
router.post("/:id/payments", async (req, res, next) => {
  try {
    const payload = paymentSchema.parse(req.body);
    const record = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, req.auth.organizationId);
      const sale = await find(tx, req);
      const existing = await replay(tx, "payment", req, payload, "recordedBy");
      if (existing) {
        if (existing.saleId !== sale.id) throw new AppError(409, "Request ID belongs to a different invoice");
        return existing;
      }
      const balance = sale.totalAmount.minus(sale.payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0)));
      const amount = new Prisma.Decimal(payload.amount);
      if (amount.gt(balance)) throw new AppError(400, `Payment exceeds the outstanding balance of ${sale.currency} ${balance.toFixed(2)}`);
      if (payload.receivedAt && payload.receivedAt > new Date()) throw new AppError(400, "Payment receipt cannot be future-dated");
      const created = await tx.payment.create({ data: {
        ...payload, requestHash: requestHash(payload), organizationId: req.auth.organizationId, saleId: sale.id, recordedBy: req.auth.userId
      } });
      await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "PAYMENT", entity: "Sale", entityId: sale.id }, tx);
      return created;
    });
    res.status(201).json({ success: true, message: "Payment recorded", data: stripReplay(record) });
  } catch (error) { next(error); }
});
export default router;
