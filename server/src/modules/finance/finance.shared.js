import crypto from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors.js";

export const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a three-letter currency code");
export const money = z.preprocess(
  (value) => typeof value === "string" && value.trim() ? Number(value) : value,
  z.number().finite().positive().max(9999999999.99).refine((value) => new Prisma.Decimal(value).decimalPlaces() <= 2, "Use at most 2 decimal places")
);
export const quantity = z.preprocess(
  (value) => typeof value === "string" && value.trim() ? Number(value) : value,
  z.number().finite().positive().max(1000000000).refine((value) => new Prisma.Decimal(value).decimalPlaces() <= 3, "Use at most 3 decimal places")
);
export const queryFields = {
  farmId: z.uuid().optional(), currency: currency.optional(),
  from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
  search: z.string().trim().max(200).optional()
};
export const validRange = (value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to);
export const range = (query) => ({ ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) });
export const scope = (req, id) => ({ organizationId: req.auth.organizationId, deletedAt: null, ...(id ? { id } : {}) });
export const filters = (query, dateField) => ({
  ...(query.farmId ? { farmId: query.farmId } : {}),
  ...(query.currency ? { currency: query.currency } : {}),
  ...((query.from || query.to) ? { [dateField]: range(query) } : {})
});
export async function relatedFarm(tx, req, farmId) {
  if (farmId && !await tx.farm.findFirst({ where: scope(req, farmId) })) throw new AppError(400, "Selected farm is not available in this workspace");
}
export function requestHash(payload) {
  const { requestId, ...data } = payload;
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
export async function replay(tx, delegate, req, payload, actorField, include) {
  if (!payload.requestId) return null;
  const existing = await tx[delegate].findUnique({ where: { organizationId_requestId: { organizationId: req.auth.organizationId, requestId: payload.requestId } }, ...(include ? { include } : {}) });
  if (!existing) return null;
  if (existing.deletedAt || existing[actorField] !== req.auth.userId || existing.requestHash !== requestHash(payload)) throw new AppError(409, "Request ID was already used for a different financial record");
  return existing;
}
export const stripReplay = ({ requestId, requestHash, ...record }) => record;
export const expenseView = (record) => ({ ...stripReplay(record), amount: Number(record.amount) });
export function saleView(record) {
  const totalPaid = record.payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
  const balance = Prisma.Decimal.max(0, record.totalAmount.minus(totalPaid));
  return {
    ...stripReplay(record), totalPaid: Number(totalPaid), balance: Number(balance),
    paymentStatus: balance.isZero() ? "PAID" : totalPaid.gt(0) ? "PARTIAL" : "UNPAID",
    payments: record.payments.map(stripReplay)
  };
}
export const saleInclude = {
  buyer: { select: { id: true, name: true, phone: true, email: true } },
  farm: { select: { id: true, name: true } }, payments: { orderBy: [{ receivedAt: "desc" }, { id: "asc" }] }
};
