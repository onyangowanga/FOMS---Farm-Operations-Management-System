import { AppError } from "../../shared/errors.js";
import { financialSummary } from "../finance/finance.routes.js";
import { filters, scope, saleInclude, saleView } from "../finance/finance.shared.js";
import { reportDate } from "./reporting.period.js";

const ROW_LIMIT = 2000;
const TOTAL_LIMIT = 10000;
const section = (id, title, columns, rows) => ({ id, title, columns, rows });
async function rows(delegate, options) {
  const result = await delegate.findMany({ ...options, take: ROW_LIMIT + 1 });
  if (result.length > ROW_LIMIT) throw new AppError(413, "Report exceeds 2,000 records in a section. Select one farm or a shorter period; nothing has been truncated.");
  return result;
}
const dated = (column) => [{ [column]: "asc" }, { id: "asc" }];
const farmName = (record) => record.farm?.name || "General workspace";
const cropName = (record) => `${record.cropName}${record.variety ? ` (${record.variety})` : ""}`;
const livestockName = (record) => `${record.species} - ${record.identifier || "Unnamed group"}`;
function bounded(sections) {
  if (sections.reduce((total, item) => total + item.rows.length, 0) > TOTAL_LIMIT) throw new AppError(413, "Report exceeds 10,000 rows. Select one farm or a shorter period; nothing has been truncated.");
  if (JSON.stringify(sections).length > 2000000) throw new AppError(413, "Report text is too large. Select one farm or a shorter period; nothing has been truncated.");
  return sections;
}
export async function reportContext(tx, req, query, period, type) {
  const organization = await tx.organization.findUnique({ where: { id: req.auth.organizationId }, select: { name: true } });
  let farm;
  if (query.farmId) {
    farm = await tx.farm.findFirst({ where: scope(req, query.farmId), select: { name: true } });
    if (!farm) throw new AppError(404, "Selected report farm is not available in this workspace");
  }
  return {
    type, title: type === "FINANCIAL" ? "Financial report" : req.auth.role === "AGRONOMIST" ? "Crop operations report" : "Operations report",
    organization: organization.name, farm: farm?.name || "All farms and general workspace",
    generatedAt: new Date().toISOString(), ...period, sections: []
  };
}
export async function operationsReport(tx, req, query, period) {
  if (query.currency) throw new AppError(400, "Currency is only a financial report filter");
  const report = await reportContext(tx, req, query, period, "OPERATIONS");
  const cropOnly = req.auth.role === "AGRONOMIST";
  const base = { ...scope(req), ...(query.farmId ? { farmId: query.farmId } : {}) };
  const when = { gte: new Date(period.from), lte: new Date(period.to) };
  const cropScope = { ...base, farm: { deletedAt: null } };
  const journalScope = { ...base, ...(cropOnly ? { subjectType: "CROP", crop: { deletedAt: null } } : {}) };
  const [crops, stages, activities, observations, followUps] = await Promise.all([
    rows(tx.cropCycle, { where: cropScope, select: { cropName: true, variety: true, status: true, acreage: true, plantingDate: true, transplantDate: true, expectedHarvest: true, farm: { select: { name: true } } }, orderBy: dated("createdAt") }),
    rows(tx.cropStage, { where: { crop: cropScope, occurredAt: when }, select: { stage: true, occurredAt: true, notes: true, crop: { select: { cropName: true, variety: true, farm: { select: { name: true } } } } }, orderBy: dated("occurredAt") }),
    rows(tx.cropActivity, { where: { crop: cropScope, occurredAt: when }, select: { type: true, customActivity: true, occurredAt: true, quantity: true, unit: true, customUnit: true, product: true, notes: true, crop: { select: { cropName: true, variety: true, farm: { select: { name: true } } } } }, orderBy: dated("occurredAt") }),
    rows(tx.journalEntry, { where: { ...journalScope, observedAt: when }, select: { observedAt: true, category: true, title: true, body: true, subjectType: true, incidentStatus: true, incidentSeverity: true, farm: { select: { name: true } }, crop: { select: { cropName: true, variety: true } }, ...(cropOnly ? {} : { livestock: { select: { species: true, identifier: true } } }) }, orderBy: dated("observedAt") }),
    rows(tx.journalFollowUp, { where: { organizationId: req.auth.organizationId, journal: journalScope, observedAt: when }, select: { observedAt: true, notes: true, incidentStatus: true, incidentSeverity: true, journal: { select: { title: true, farm: { select: { name: true } }, crop: { select: { cropName: true, variety: true } } } } }, orderBy: dated("observedAt") })
  ]);
  const sections = [
    section("crops", "Crop status - current snapshot", ["Farm", "Crop", "Current stage", "Acres", "Planted", "Transplanted", "Expected harvest"], crops.map(r => [farmName(r), cropName(r), r.status, r.acreage, reportDate(r.plantingDate), reportDate(r.transplantDate), reportDate(r.expectedHarvest)])),
    section("stages", "Crop stages recorded in period", ["Date", "Farm", "Crop", "Stage", "Notes"], stages.map(r => [reportDate(r.occurredAt), farmName(r.crop), cropName(r.crop), r.stage, r.notes])),
    section("activities", "Crop activities in period", ["Date", "Farm", "Crop", "Activity", "Quantity", "Unit", "Product", "Notes"], activities.map(r => [reportDate(r.occurredAt), farmName(r.crop), cropName(r.crop), r.customActivity || r.type, r.quantity, r.customUnit || r.unit, r.product, r.notes])),
    section("observations", cropOnly ? "Crop observations in period" : "Daily observations and issues in period", ["Date", "Farm", "Subject", "Category", "Title", "Observation", "Current incident status", "Current severity"], observations.map(r => [reportDate(r.observedAt), farmName(r), r.crop ? cropName(r.crop) : r.livestock ? livestockName(r.livestock) : r.subjectType, r.category, r.title, r.body, r.incidentStatus, r.incidentSeverity])),
    section("followUps", "Incident follow-ups in period", ["Date", "Farm", "Report", "Crop", "Recorded status", "Recorded severity", "Notes"], followUps.map(r => [reportDate(r.observedAt), farmName(r.journal), r.journal.title, r.journal.crop ? cropName(r.journal.crop) : "", r.incidentStatus, r.incidentSeverity, r.notes]))
  ];
  if (!cropOnly) {
    const [livestock, events, completions, stock, movements, maintenance] = await Promise.all([
      rows(tx.livestock, { where: { ...base, farm: { deletedAt: null } }, select: { species: true, identifier: true, trackingMode: true, quantity: true, healthStatus: true, weightKg: true, farm: { select: { name: true } } }, orderBy: dated("createdAt") }),
      rows(tx.livestockEvent, { where: { livestock: { ...base, farm: { deletedAt: null } }, occurredAt: when }, select: { occurredAt: true, type: true, title: true, quantity: true, weightKg: true, feedKg: true, healthStatus: true, notes: true, livestock: { select: { species: true, identifier: true, farm: { select: { name: true } } } } }, orderBy: dated("occurredAt") }),
      rows(tx.taskEvent, { where: { task: base, toStatus: "COMPLETED", createdAt: when }, select: { createdAt: true, notes: true, task: { select: { title: true, status: true, farm: { select: { name: true } } } } }, orderBy: dated("createdAt") }),
      rows(tx.inventoryItem, { where: base, select: { name: true, trackingMode: true, quantity: true, unit: true, reorderLevel: true, assetCondition: true, nextMaintenanceDate: true, farm: { select: { name: true } } }, orderBy: dated("createdAt") }),
      rows(tx.stockMovement, { where: { organizationId: req.auth.organizationId, item: base, occurredAt: when }, select: { occurredAt: true, type: true, quantity: true, balanceAfter: true, notes: true, item: { select: { name: true, unit: true, farm: { select: { name: true } } } } }, orderBy: dated("occurredAt") }),
      rows(tx.inventoryAssetEvent, { where: { organizationId: req.auth.organizationId, item: base, observedAt: when }, select: { observedAt: true, type: true, condition: true, nextMaintenanceDate: true, notes: true, item: { select: { name: true, farm: { select: { name: true } } } } }, orderBy: dated("observedAt") })
    ]);
    sections.push(
      section("livestock", "Livestock status - current snapshot", ["Farm", "Livestock", "Tracking", "Current quantity", "Current health", "Current weight (kg)"], livestock.map(r => [farmName(r), livestockName(r), r.trackingMode, r.quantity, r.healthStatus, r.weightKg])),
      section("livestockEvents", "Livestock events and production in period", ["Date", "Farm", "Livestock", "Event", "Title", "Quantity", "Weight (kg)", "Feed (kg)", "Recorded health", "Notes"], events.map(r => [reportDate(r.occurredAt), farmName(r.livestock), livestockName(r.livestock), r.type, r.title, r.quantity, r.weightKg, r.feedKg, r.healthStatus, r.notes])),
      section("completedTasks", "Task completion submissions in period", ["Submitted", "Farm", "Task", "Current status", "Notes"], completions.map(r => [reportDate(r.createdAt), farmName(r.task), r.task.title, r.task.status, r.notes])),
      section("stock", "Inventory - current snapshot", ["Farm", "Item", "Tracking", "Current quantity", "Unit", "Reorder level", "Low stock", "Current condition", "Next maintenance"], stock.map(r => [farmName(r), r.name, r.trackingMode, Number(r.quantity), r.unit, Number(r.reorderLevel), r.trackingMode === "BATCH" && r.quantity.lte(r.reorderLevel) ? "Yes" : "No", r.assetCondition, reportDate(r.nextMaintenanceDate)])),
      section("movements", "Stock movements in period", ["Date", "Farm", "Item", "Type", "Quantity / counted stock", "Unit", "Balance after", "Notes"], movements.map(r => [reportDate(r.occurredAt), farmName(r.item), r.item.name, r.type, Number(r.quantity), r.item.unit, r.balanceAfter === null ? null : Number(r.balanceAfter), r.notes])),
      section("maintenance", "Equipment events in period", ["Date", "Farm", "Equipment", "Event", "Recorded condition", "Next maintenance", "Notes"], maintenance.map(r => [reportDate(r.observedAt), farmName(r.item), r.item.name, r.type, r.condition, reportDate(r.nextMaintenanceDate), r.notes]))
    );
  }
  report.notes = [
    "Period dates use Africa/Nairobi (UTC+03:00); weeks run Monday to Sunday.",
    "Event rows use their observation/activity date; task completions use submission event time. Re-submissions are separate events, not unique completed tasks.",
    "Snapshots and incident labels show current state, not historical closing state. Archived records are excluded.",
    "Quantities with different units/species/event types are not added together. Journal and maintenance costs are not accounting entries.",
    cropOnly ? "Agronomist report is crop-only. No general/livestock observations, tasks, inventory or financial data." : "Financial reports and receipts are separate. Photos and private file storage are not embedded."
  ];
  report.sections = bounded(sections);
  report.metrics = { cropCycles: crops.length, cropActivities: activities.length, observations: observations.length, incidentFollowUps: followUps.length };
  return report;
}

export async function financeReport(tx, req, query, period) {
  const report = await reportContext(tx, req, query, period, "FINANCIAL");
  const financialQuery = { from: period.from, to: period.to, ...(query.farmId ? { farmId: query.farmId } : {}), ...(query.currency ? { currency: query.currency } : {}) };
  const salesWhere = { ...scope(req), ...filters(financialQuery, "soldAt") };
  const expenseWhere = { ...scope(req), ...filters(financialQuery, "expenseDate") };
  const collectionWhere = { organizationId: req.auth.organizationId, receivedAt: { gte: new Date(period.from), lte: new Date(period.to) }, sale: { ...scope(req), ...(query.farmId ? { farmId: query.farmId } : {}), ...(query.currency ? { currency: query.currency } : {}) } };
  const counts = await Promise.all([
    tx.sale.count({ where: salesWhere }), tx.expense.count({ where: expenseWhere }),
    tx.payment.count({ where: collectionWhere }), tx.payment.count({ where: { sale: salesWhere } })
  ]);
  if (counts.some(count => count > ROW_LIMIT) || counts.reduce((sum, count) => sum + count, 0) > TOTAL_LIMIT) throw new AppError(413, "Financial report is too large. Select one farm, one currency or a shorter period; nothing has been truncated.");
  const [summary, invoices, expenses, collections] = await Promise.all([
    financialSummary(tx, req, financialQuery),
    tx.sale.findMany({ where: salesWhere, include: saleInclude, orderBy: dated("soldAt") }),
    tx.expense.findMany({ where: expenseWhere, select: { description: true, category: true, amount: true, currency: true, expenseDate: true, approvedAt: true, supplier: true, farm: { select: { name: true } } }, orderBy: dated("expenseDate") }),
    tx.payment.findMany({ where: collectionWhere, select: { receivedAt: true, amount: true, method: true, reference: true, sale: { select: { invoiceNumber: true, currency: true, farm: { select: { name: true } } } } }, orderBy: dated("receivedAt") })
  ]);
  report.currency = query.currency || "Separate currency totals";
  report.notes = [
    "Period dates use Africa/Nairobi (UTC+03:00); weeks run Monday to Sunday. Currencies are never combined or converted.",
    "Profit = invoiced revenue minus currently owner-approved expenses. Pending expenses are shown separately and excluded from profit.",
    "Revenue uses sale date; expenses use expense date; collections use receipt date, including payments for older invoices.",
    "Outstanding is the current remaining balance of invoices sold in the period, not a historical closing balance. Approval reflects current status, not approval-date accounting.",
    "Archived records are excluded. Operational journal/maintenance costs are not posted as expenses. Private receipts are not embedded."
  ];
  report.metrics = { invoices: invoices.length, expenses: expenses.length, collections: collections.length };
  report.sections = bounded([
    section("summary", "Financial summary by currency", ["Currency", "Invoiced revenue", "Approved expenses", "Pending expenses", "Profit", "Payments collected", "Current outstanding"], summary.map(r => [r.currency, r.revenue, r.approvedExpenses, r.pendingExpenses, r.profit, r.collected, r.outstanding])),
    section("categories", "Expense breakdown", ["Currency", "Category", "Approved", "Pending"], summary.flatMap(r => r.expenseCategories.map(c => [r.currency, c.category, c.approved, c.pending]))),
    section("invoices", "Invoices sold in period", ["Sold", "Farm", "Invoice", "Buyer", "Product", "Quantity", "Unit", "Currency", "Unit price", "Revenue", "Collected to date", "Current balance", "Current status"], invoices.map(record => { const r = saleView(record); return [reportDate(r.soldAt), farmName(r), r.invoiceNumber, r.buyer?.name, r.product, r.quantity, r.unit, r.currency, Number(r.unitPrice), Number(r.totalAmount), r.totalPaid, r.balance, r.paymentStatus]; })),
    section("expenses", "Expenses dated in period", ["Date", "Farm", "Description", "Category", "Supplier", "Currency", "Amount", "Current approval", "Approved at"], expenses.map(r => [reportDate(r.expenseDate), farmName(r), r.description, r.category, r.supplier, r.currency, Number(r.amount), r.approvedAt ? "APPROVED" : "PENDING", reportDate(r.approvedAt)])),
    section("collections", "Payments received in period", ["Received", "Farm", "Invoice", "Currency", "Amount", "Method", "Reference"], collections.map(r => [reportDate(r.receivedAt), farmName(r.sale), r.sale.invoiceNumber, r.sale.currency, Number(r.amount), r.method, r.reference]))
  ]);
  return report;
}
