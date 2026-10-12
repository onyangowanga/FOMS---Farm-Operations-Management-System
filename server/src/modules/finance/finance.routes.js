import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { authorize } from "../../middleware/authenticate.js";
import { queryFields, validRange, filters, range, scope, saleView, saleInclude } from "./finance.shared.js";

const router = Router();
router.use(authorize("OWNER", "MANAGER"));
const querySchema = z.object(queryFields).omit({ search: true }).strict().refine(validRange, { message: "Start date must not follow end date" });
export async function financialSummary(tx, req, query) {
  const [sales, expenses, payments] = await Promise.all([
    tx.sale.findMany({ where: { ...scope(req), ...filters(query, "soldAt") }, include: saleInclude }),
    tx.expense.findMany({ where: { ...scope(req), ...filters(query, "expenseDate") } }),
    tx.payment.findMany({ where: {
      organizationId: req.auth.organizationId, ...((query.from || query.to) ? { receivedAt: range(query) } : {}),
      sale: { ...scope(req), ...(query.farmId ? { farmId: query.farmId } : {}), ...(query.currency ? { currency: query.currency } : {}) }
    }, include: { sale: { select: { currency: true } } } })
  ]);
  const groups = new Map();
  const group = (code) => {
    if (!groups.has(code)) groups.set(code, {
      currency: code, revenue: new Prisma.Decimal(0), approvedExpenses: new Prisma.Decimal(0), pendingExpenses: new Prisma.Decimal(0),
      collected: new Prisma.Decimal(0), outstanding: new Prisma.Decimal(0), invoiceCount: 0, approvedExpenseCount: 0, pendingExpenseCount: 0, expenseCategories: {}
    });
    return groups.get(code);
  };
  if (query.currency) group(query.currency);
  for (const record of sales) {
    const value = group(record.currency);
    value.revenue = value.revenue.plus(record.totalAmount);
    value.outstanding = value.outstanding.plus(saleView(record).balance);
    value.invoiceCount++;
  }
  for (const record of expenses) {
    const value = group(record.currency);
    const key = record.approvedAt ? "approvedExpenses" : "pendingExpenses";
    value[key] = value[key].plus(record.amount);
    value[record.approvedAt ? "approvedExpenseCount" : "pendingExpenseCount"]++;
    const category = value.expenseCategories[record.category] ||= { approved: new Prisma.Decimal(0), pending: new Prisma.Decimal(0) };
    category[record.approvedAt ? "approved" : "pending"] = category[record.approvedAt ? "approved" : "pending"].plus(record.amount);
  }
  for (const record of payments) {
    const value = group(record.sale.currency);
    value.collected = value.collected.plus(record.amount);
  }
  return [...groups.values()].sort((a, b) => a.currency.localeCompare(b.currency)).map((value) => ({
    ...value, profit: Number(value.revenue.minus(value.approvedExpenses)),
    revenue: Number(value.revenue), approvedExpenses: Number(value.approvedExpenses), pendingExpenses: Number(value.pendingExpenses),
    collected: Number(value.collected), outstanding: Number(value.outstanding),
    expenseCategories: Object.entries(value.expenseCategories).map(([category, amount]) => ({ category, approved: Number(amount.approved), pending: Number(amount.pending) }))
  }));
}
router.get("/", async (req, res, next) => {
  try {
    const query = querySchema.parse(req.query);
    const data = await prisma.$transaction((tx) => financialSummary(tx, req, query), { isolationLevel: "RepeatableRead" });
    res.json({ success: true, data, meta: { ...query, basis: "INVOICED_REVENUE_LESS_APPROVED_EXPENSES", collectionsBasis: "PAYMENT_RECEIVED_DATE", outstandingBasis: "CURRENT_BALANCE_OF_INVOICES_IN_SELECTED_SALE_PERIOD" } });
  } catch (error) { next(error); }
});
export default router;
