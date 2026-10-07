import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/errors.js";
import { writeAudit } from "../../shared/audit.js";

const router = Router();
const buyerSchema = z.object({
  farmId: z.uuid().nullable().optional(),
  name: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional()
});
const saleSchema = z.object({
  farmId: z.uuid().nullable().optional(),
  buyerId: z.uuid().nullable().optional(),
  buyer: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.email().trim().toLowerCase().nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional()
  }).optional(),
  product: z.string().trim().min(2).max(160),
  quantity: z.coerce.number().finite().positive(),
  unit: z.string().trim().min(1).max(30),
  unitPrice: z.coerce.number().finite().positive(),
  currency: z.string().trim().length(3).toUpperCase().default("KES"),
  soldAt: z.coerce.date().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional()
});
const paymentSchema = z.object({
  amount: z.coerce.number().finite().positive(),
  method: z.enum(["CASH", "MPESA", "BANK_TRANSFER", "CHEQUE", "OTHER"]),
  reference: z.string().trim().max(120).optional(),
  receivedAt: z.coerce.date().optional()
});
const orgFarm = (organizationId) => ({ organizationId, deletedAt: null });

router.get("/buyers", authorize("OWNER", "MANAGER"), async (req, res, next) => {
  try {
    const buyers = await prisma.buyer.findMany({
      where: orgFarm(req.auth.organizationId),
      orderBy: { name: "asc" },
      include: { farm: { select: { id: true, name: true } }, _count: { select: { sales: true } } }
    });
    res.json({ success: true, data: buyers });
  } catch (error) { next(error); }
});

router.post("/buyers", authorize("OWNER", "MANAGER"), async (req, res, next) => {
  try {
    const payload = buyerSchema.parse(req.body);
    if (payload.farmId && !(await prisma.farm.findFirst({ where: { id: payload.farmId, ...orgFarm(req.auth.organizationId) }, select: { id: true } }))) {
      throw new AppError(400, "The selected farm is not available in this workspace");
    }
    const buyer = await prisma.buyer.create({
      data: { ...payload, organizationId: req.auth.organizationId, createdBy: req.auth.userId }
    });
    await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "CREATE", entity: "Buyer", entityId: buyer.id });
    res.status(201).json({ success: true, message: "Buyer created", data: buyer });
  } catch (error) { next(error); }
});

router.get("/", authorize("OWNER", "MANAGER"), async (req, res, next) => {
  try {
    const sales = await prisma.sale.findMany({
      where: orgFarm(req.auth.organizationId),
      orderBy: { soldAt: "desc" },
      include: {
        buyer: { select: { id: true, name: true, phone: true, email: true } },
        farm: { select: { id: true, name: true } },
        payments: { orderBy: { receivedAt: "desc" } }
      }
    });
    const data = sales.map((sale) => {
      const totalPaid = sale.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      const total = Number(sale.totalAmount);
      return { ...sale, totalPaid: Number(totalPaid.toFixed(2)), balance: Number(Math.max(0, total - totalPaid).toFixed(2)), paymentStatus: totalPaid >= total ? "PAID" : totalPaid > 0 ? "PARTIAL" : "UNPAID" };
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

router.post("/", authorize("OWNER", "MANAGER"), async (req, res, next) => {
  try {
    const payload = saleSchema.parse(req.body);
    if (!payload.buyerId && !payload.buyer) throw new AppError(400, "Select an existing buyer or enter the buyer's details");
    if (payload.farmId && !(await prisma.farm.findFirst({ where: { id: payload.farmId, ...orgFarm(req.auth.organizationId) }, select: { id: true } }))) {
      throw new AppError(400, "The selected farm is not available in this workspace");
    }
    if (payload.buyerId && !(await prisma.buyer.findFirst({ where: { id: payload.buyerId, ...orgFarm(req.auth.organizationId) }, select: { id: true } }))) {
      throw new AppError(400, "The selected buyer is not available in this workspace");
    }
    const unitPrice = new Prisma.Decimal(payload.unitPrice.toFixed(2));
    const totalAmount = unitPrice.mul(payload.quantity).toDecimalPlaces(2);
    const invoiceNumber = `FOMS-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const sale = await prisma.$transaction(async (tx) => {
      const buyer = payload.buyerId
        ? null
        : await tx.buyer.create({ data: { ...payload.buyer, farmId: payload.farmId, organizationId: req.auth.organizationId, createdBy: req.auth.userId } });
      return tx.sale.create({
        data: {
          organizationId: req.auth.organizationId,
          farmId: payload.farmId,
          buyerId: payload.buyerId || buyer.id,
          invoiceNumber,
          product: payload.product,
          quantity: payload.quantity,
          unit: payload.unit,
          unitPrice,
          totalAmount,
          currency: payload.currency,
          soldAt: payload.soldAt,
          dueDate: payload.dueDate,
          notes: payload.notes,
          createdBy: req.auth.userId
        },
        include: { buyer: true, payments: true }
      });
    });
    await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "CREATE", entity: "Sale", entityId: sale.id });
    res.status(201).json({ success: true, message: `Invoice ${invoiceNumber} created`, data: { ...sale, totalPaid: 0, balance: Number(totalAmount), paymentStatus: "UNPAID" } });
  } catch (error) { next(error); }
});

router.post("/:id/payments", authorize("OWNER", "MANAGER"), async (req, res, next) => {
  try {
    const saleId = z.uuid().parse(req.params.id);
    const payload = paymentSchema.parse(req.body);
    const payment = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${saleId}::uuid AND "organizationId" = ${req.auth.organizationId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
      const sale = await tx.sale.findFirst({ where: { id: saleId, ...orgFarm(req.auth.organizationId) } });
      if (!sale) throw new AppError(404, "Invoice was not found");
      const paid = await tx.payment.aggregate({ where: { saleId, organizationId: req.auth.organizationId }, _sum: { amount: true } });
      const balance = Number(sale.totalAmount) - Number(paid._sum.amount || 0);
      if (payload.amount > balance + 0.001) throw new AppError(400, `Payment exceeds the outstanding balance of ${sale.currency} ${balance.toFixed(2)}`);
      return tx.payment.create({
        data: {
          organizationId: req.auth.organizationId,
          saleId,
          amount: new Prisma.Decimal(payload.amount.toFixed(2)),
          method: payload.method,
          reference: payload.reference,
          receivedAt: payload.receivedAt,
          recordedBy: req.auth.userId
        }
      });
    });
    await writeAudit({ organizationId: req.auth.organizationId, userId: req.auth.userId, action: "PAYMENT", entity: "Sale", entityId: saleId });
    res.status(201).json({ success: true, message: "Payment recorded", data: payment });
  } catch (error) { next(error); }
});

export default router;
