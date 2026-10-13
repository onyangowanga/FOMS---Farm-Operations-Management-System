import { api } from "./api.js?v=0.10.0";
import { field, modal } from "./v03.js?v=0.10.0";
import { offlineStore } from "./offline.js";

let context;
const listFilters = { expenses: {}, sales: {} };
export function configureFinance(value) { context = value; }
const esc = (value) => context.escapeHtml(value);
const label = (value) => String(value).toLowerCase().replaceAll("_", " ");
const date = (value) => value ? new Date(value).toLocaleDateString() : "Not set";
const day = (value = new Date()) => {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const dateISO = (value, end = false) => value ? new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}`).toISOString() : undefined;
const money = (amount, currency) => `${currency} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const categories = ["LABOR", "SEED", "FERTILIZER", "CHEMICALS", "FEED", "LIVESTOCK", "TRANSPORT", "VETERINARY", "FUEL", "REPAIRS", "OTHER"];
const methods = ["CASH", "MPESA", "BANK_TRANSFER", "CHEQUE", "OTHER"];
let summaryFilters = { from: day(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: day() };
function params(values) {
  return new URLSearchParams(Object.entries({ ...values, from: dateISO(values.from), to: dateISO(values.to, true) }).filter(([, value]) => value));
}
function commonFilters(values, farms) {
  return field("farmId", "Farm", "select", values.farmId || "", { items: [["", "All farms / unassigned"], ...farms.map((farm) => [farm.id, farm.name])] }) +
    field("currency", "Currency (blank = separate totals for each)", "text", values.currency || "", { maxlength: 3 }) +
    field("from", "From date", "date", values.from || "") + field("to", "Through date", "date", values.to || "");
}
function buttons() { return '<div class="flex flex-wrap items-end gap-2"><button class="btn-primary">Apply filters</button><button data-reset type="button" class="btn-secondary">Reset</button></div>'; }
async function action(button, operation) {
  button.disabled = true;
  try { const result = await operation(); context.showToast(result.message); await context.reload(); }
  catch (error) { context.showToast(error.message, "error"); button.disabled = false; }
}
export async function openExpenseModal(expense = {}) {
  try {
    const farms = await context.loadAll("/farms");
    const requestId = crypto.randomUUID();
    const form = modal(expense.id ? "Edit pending expense" : "Record expense",
      field("description", "Description", "text", expense.description || "", { required: true, maxlength: 200 }) +
      '<div class="grid gap-4 sm:grid-cols-2">' +
      field("category", "Category", "select", expense.category || "OTHER", { items: categories.map((value) => [value, label(value)]) }) +
      field("farmId", "Farm", "select", expense.farmId || "", { items: [["", "General workspace"], ...farms.map((farm) => [farm.id, farm.name])] }) +
      field("amount", "Amount", "number", expense.amount ?? "", { required: true }) +
      field("currency", "Currency code", "text", expense.currency || "KES", { required: true, maxlength: 3 }) +
      field("expenseDate", "Expense date", "date", day(expense.expenseDate || new Date()), { required: true }) +
      field("paymentMethod", "Payment method", "select", expense.paymentMethod || "", { items: [["", "Not specified"], ...methods.map((value) => [value, label(value)]), ...(expense.paymentMethod && !methods.includes(expense.paymentMethod) ? [[expense.paymentMethod, expense.paymentMethod]] : [])] }) +
      '</div>' + field("supplier", "Supplier", "text", expense.supplier || "") +
      field("notes", "Notes", "textarea", expense.notes || "") +
      '<p class="text-xs text-slate-500">Only owner-approved expenses reduce profit. Attach private receipt photos/PDFs from the expense detail page before approval. Approved expenses and receipts are locked.</p>',
      async (values) => {
        const payload = { ...values, amount: Number(values.amount), farmId: values.farmId || null, expenseDate: dateISO(values.expenseDate), supplier: values.supplier || null, paymentMethod: values.paymentMethod || null, notes: values.notes || null };
        if (expense.livestockEventId) for (const name of ["farmId", "category", "expenseDate"]) delete payload[name];
        const response = expense.id ? await api.patch(`/expenses/${expense.id}`, payload) : await api.post("/expenses", { ...payload, requestId });
        if (!expense.id) location.hash = `#expenses/${response.data.id}`;
        return response;
      });
    form.elements.amount.step = "0.01"; form.elements.amount.min = "0.01";
    if (expense.livestockEventId) {
      for (const name of ["farmId", "category"]) form.elements[name].disabled = true;
      form.elements.expenseDate.readOnly = true;
    }
  } catch (error) { context.showToast(error.message, "error"); }
}
export async function openSaleModal(sale = {}) {
  try {
    const [farms, buyers] = await Promise.all([context.loadAll("/farms"), api.get("/sales/buyers")]);
    const requestId = crypto.randomUUID();
    const form = modal(sale.id ? "Edit unpaid invoice" : "Record sale / create invoice",
      field("product", "Product / produce", "text", sale.product || "", { required: true, maxlength: 160 }) +
      '<div class="grid gap-4 sm:grid-cols-2">' +
      field("quantity", "Quantity", "number", sale.quantity || "", { required: true }) +
      field("unit", "Unit", "text", sale.unit || "", { required: true, maxlength: 30 }) +
      field("unitPrice", "Unit price", "number", sale.unitPrice || "", { required: true }) +
      field("currency", "Currency code", "text", sale.currency || "KES", { required: true, maxlength: 3 }) +
      field("soldAt", "Sale date", "date", day(sale.soldAt || new Date()), { required: true }) +
      field("dueDate", "Due date (optional)", "date", sale.dueDate ? day(sale.dueDate) : "") +
      field("farmId", "Farm", "select", sale.farmId || "", { items: [["", "General workspace"], ...farms.map((farm) => [farm.id, farm.name])] }) +
      field("buyerId", "Buyer", "select", sale.buyerId || "", { items: [["", sale.id ? "Select a buyer" : "New buyer"], ...buyers.data.map((buyer) => [buyer.id, buyer.name])] }) +
      '</div>' +
      (!sale.id ? '<div data-new-buyer class="space-y-3">' + field("buyerName", "New buyer name", "text", "", { required: true, maxlength: 120 }) + field("buyerPhone", "Buyer phone (optional)", "text", "", { maxlength: 40 }) + field("buyerEmail", "Buyer email (optional)", "email") + '</div>' : "") +
      field("notes", "Notes", "textarea", sale.notes || "") +
      '<p class="text-xs text-slate-500">Invoices count as revenue on the sale date. Payments are recorded separately. Invoices with payments are locked; currency totals are never combined.</p>',
      async (values) => {
        const payload = { product: values.product, quantity: Number(values.quantity), unit: values.unit, unitPrice: Number(values.unitPrice), currency: values.currency,
          farmId: values.farmId || null, soldAt: dateISO(values.soldAt), dueDate: values.dueDate ? dateISO(values.dueDate, true) : null, notes: values.notes || null,
          ...(values.buyerId ? { buyerId: values.buyerId } : { buyer: { name: values.buyerName, ...(values.buyerPhone ? { phone: values.buyerPhone } : {}), ...(values.buyerEmail ? { email: values.buyerEmail } : {}) } })
        };
        if (sale.livestockEventId) for (const name of ["product", "quantity", "unit", "farmId", "soldAt"]) delete payload[name];
        const response = sale.id ? await api.patch(`/sales/${sale.id}`, payload) : await api.post("/sales", { ...payload, requestId });
        if (!sale.id) location.hash = `#sales/${response.data.id}`;
        return response;
      });
    form.elements.quantity.step = "0.001"; form.elements.quantity.min = "0.001";
    form.elements.unitPrice.step = "0.01"; form.elements.unitPrice.min = "0.01";
    if (sale.livestockEventId) {
      for (const name of ["product", "quantity", "unit", "soldAt"]) form.elements[name].readOnly = true;
      form.elements.farmId.disabled = true;
    }
    if (!sale.id) form.elements.buyerId.onchange = () => {
      const adding = !form.elements.buyerId.value;
      form.querySelector("[data-new-buyer]").hidden = !adding;
      form.elements.buyerName.required = adding;
    };
    else form.elements.buyerId.required = true;
  } catch (error) { context.showToast(error.message, "error"); }
}
function paymentModal(sale) {
  const requestId = crypto.randomUUID();
  const form = modal("Record invoice payment",
    `<p class="break-words text-sm">${esc(sale.invoiceNumber)} - balance ${esc(money(sale.balance, sale.currency))}</p>` +
    field("amount", `Amount (${sale.currency})`, "number", "", { required: true }) +
    field("method", "Payment method", "select", "MPESA", { items: methods.map((value) => [value, label(value)]) }) +
    field("reference", "Reference", "text", "", { maxlength: 120 }) +
    field("receivedAt", "Date received", "date", day(), { required: true }) +
    '<p class="text-xs text-slate-500">The payment uses the invoice currency. Review carefully; payment history is append-only.</p>',
    (values) => api.post(`/sales/${sale.id}/payments`, { requestId, amount: Number(values.amount), method: values.method, reference: values.reference, receivedAt: dateISO(values.receivedAt) }));
  form.elements.amount.step = "0.01"; form.elements.amount.min = "0.01"; form.elements.amount.max = sale.balance;
}
function receiptModal(id) {
  modal("Attach expense receipt", '<label class="block"><span class="label">Photo or PDF (maximum 10 MB)</span><input class="field" name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label><p class="text-xs text-slate-500">Up to 10 private active receipts. Attach before owner approval.</p>',
    (_values, form) => {
      const file = form.elements.file.files[0];
      if (!file) throw new Error("Select a receipt");
      if (file.size > 10 * 1024 * 1024) throw new Error("Receipt cannot exceed 10 MB");
      const payload = new FormData(); payload.set("file", file);
      return api.upload(`/expenses/${id}/attachments`, payload);
    });
}
async function expenseDetail(id) {
  const [response, attachments] = await Promise.all([api.get(`/expenses/${id}`), api.get(`/expenses/${id}/attachments`)]);
  const expense = response.data;
  const pending = !expense.approvedAt;
  const root = document.querySelector("#content");
  root.innerHTML = `<a href="#expenses" class="text-sm font-semibold text-forest-700">Back to expenses</a>
    <div class="my-5 flex flex-wrap justify-between gap-3"><div class="w-full min-w-0 sm:flex-1"><h1 class="break-words text-2xl font-semibold">${esc(expense.description)}</h1><p class="mt-2 text-sm">${esc(money(expense.amount, expense.currency))} - ${pending ? "Pending approval (excluded from profit)" : "Approved (included in profit)"}</p></div>${pending ? `<div class="flex flex-wrap gap-2"><button data-edit class="btn-secondary">Edit</button>${expense.livestockEventId ? "" : '<button data-archive class="btn-secondary">Archive</button>'}</div>` : ""}</div>
    <section class="card min-w-0 break-words"><p class="text-sm">Date: ${esc(date(expense.expenseDate))} - ${esc(expense.farm?.name || "General workspace")}</p><p class="mt-2 text-sm">Category: ${esc(label(expense.category))}</p>${expense.livestockEventId ? '<p class="mt-2 text-xs text-slate-500">Farm, category and date are fixed by the linked livestock purchase event.</p>' : ""}<p class="mt-2 text-sm">Supplier: ${esc(expense.supplier || "Not set")}</p><p class="mt-2 text-sm">Payment method: ${esc(expense.paymentMethod || "Not set")}</p><p class="mt-2 text-sm">Recorded by: ${esc(expense.creator?.name || "Previous user")}</p>${expense.notes ? `<p class="mt-3 whitespace-pre-wrap text-sm">${esc(expense.notes)}</p>` : ""}
    ${pending && context.getUser().role === "OWNER" ? '<button data-approve class="btn-primary mt-4">Approve expense</button>' : ""}${expense.approvedAt ? `<p class="mt-4 text-sm">Approved ${esc(date(expense.approvedAt))}. Record and receipts are locked.</p>` : ""}</section>
    <section class="card mt-5"><div class="flex flex-wrap justify-between gap-2"><h2 class="text-lg font-semibold">Private receipts</h2>${pending ? '<button data-upload class="btn-secondary">Attach receipt</button>' : ""}</div><div class="mt-4 space-y-3">${attachments.data.map((file) => `<article class="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border p-3"><a class="min-w-0 max-w-full break-words text-sm text-forest-700" href="${esc(file.downloadPath)}" download>${esc(file.originalName)}</a>${pending ? `<button data-remove="${file.id}" class="btn-secondary">Remove</button>` : ""}</article>`).join("") || '<p class="text-sm text-slate-500">No receipts attached.</p>'}</div></section>`;
  root.querySelector("[data-edit]")?.addEventListener("click", () => openExpenseModal(expense));
  root.querySelector("[data-upload]")?.addEventListener("click", () => receiptModal(id));
  root.querySelector("[data-approve]")?.addEventListener("click", (event) => {
    if (confirm("Approve this amount and lock the expense and its receipts? It will now reduce profit.")) action(event.currentTarget, () => api.post(`/expenses/${id}/approve`, {}));
  });
  root.querySelector("[data-archive]")?.addEventListener("click", async (event) => {
    if (!confirm("Archive this pending expense? History will remain stored.")) return;
    await action(event.currentTarget, async () => { const result = await api.delete(`/expenses/${id}`); location.hash = "#expenses"; return result; });
  });
  root.querySelectorAll("[data-remove]").forEach((button) => button.onclick = () => action(button, () => api.delete(`/expenses/${id}/attachments/${button.dataset.remove}`)));
}
async function saleDetail(id) {
  const sale = (await api.get(`/sales/${id}`)).data;
  const root = document.querySelector("#content");
  root.innerHTML = `<a href="#sales" class="text-sm font-semibold text-forest-700">Back to sales</a><div class="my-5 flex flex-wrap justify-between gap-3"><div class="w-full min-w-0 sm:flex-1"><h1 class="break-words text-2xl font-semibold">${esc(sale.invoiceNumber)}</h1><p class="mt-2 break-words text-sm">${esc(sale.product)} - ${esc(sale.buyer?.name || "Previous buyer")}</p></div>${!sale.payments.length ? `<div class="flex flex-wrap gap-2"><button data-edit class="btn-secondary">Edit unpaid invoice</button>${sale.livestockEventId ? "" : '<button data-archive class="btn-secondary">Archive</button>'}</div>` : ""}</div>
    <section class="card min-w-0 break-words"><p class="text-lg font-semibold">${esc(money(sale.totalAmount, sale.currency))} - ${esc(label(sale.paymentStatus))}</p><p class="mt-2 text-sm">Quantity: ${Number(sale.quantity).toLocaleString()} ${esc(sale.unit)} at ${esc(money(sale.unitPrice, sale.currency))}</p><p class="mt-2 text-sm">Collected: ${esc(money(sale.totalPaid, sale.currency))}</p><p class="mt-2 text-sm">Outstanding: ${esc(money(sale.balance, sale.currency))}</p><p class="mt-2 text-sm">Sold: ${esc(date(sale.soldAt))} / due: ${esc(date(sale.dueDate))}</p><p class="mt-2 text-sm">Farm: ${esc(sale.farm?.name || "General workspace")}</p>${sale.notes ? `<p class="mt-3 whitespace-pre-wrap text-sm">${esc(sale.notes)}</p>` : ""}${sale.balance > 0 ? '<button data-payment class="btn-primary mt-4">Record payment</button>' : ""}</section>
    <section class="card mt-5"><h2 class="text-lg font-semibold">Payment history</h2><p class="mt-2 text-xs text-slate-500">Append-only. Currency is fixed by this invoice.</p><div class="mt-4 space-y-3">${sale.payments.map((payment) => `<article class="min-w-0 rounded-xl border p-3"><p class="text-sm font-semibold">${esc(money(payment.amount, sale.currency))} - ${esc(label(payment.method))}</p><p class="mt-2 text-xs text-slate-500">Received ${esc(date(payment.receivedAt))}</p><p class="mt-2 break-words text-sm">${esc(payment.reference || "No reference")}</p></article>`).join("") || '<p class="text-sm text-slate-500">No payments yet.</p>'}</div></section>`;
  root.querySelector("[data-edit]")?.addEventListener("click", () => openSaleModal(sale));
  root.querySelector("[data-payment]")?.addEventListener("click", () => paymentModal(sale));
  root.querySelector("[data-archive]")?.addEventListener("click", async (event) => {
    if (!confirm("Archive this unpaid invoice? It will be excluded from active revenue summaries.")) return;
    await action(event.currentTarget, async () => { const result = await api.delete(`/sales/${id}`); location.hash = "#sales"; return result; });
  });
}
async function renderList(type, id) {
  if (id) return type === "expenses" ? expenseDetail(id) : saleDetail(id);
  const farms = await context.loadAll("/farms");
  const values = listFilters[type];
  const query = params(values);
  const data = type === "expenses" ? await context.loadAll(`/expenses?${query}`) : (await api.get(`/sales?${query}`)).data;
  const expense = type === "expenses";
  const root = document.querySelector("#content");
  root.innerHTML = `<div class="mb-5 flex flex-wrap justify-between gap-3"><div><h1 class="text-2xl font-semibold">${expense ? "Expenses" : "Sales & invoices"}</h1><p class="mt-2 text-sm text-slate-500">${data.length} matching records. <a href="#finance" class="text-forest-700">View financial summary</a></p></div><button data-add class="btn-primary">${expense ? "Record expense" : "Record sale"}</button></div>
    <form data-filters class="card mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${field("search", "Search", "search", values.search || "")}${commonFilters(values, farms)}
    ${expense ? field("approval", "Approval", "select", values.approval || "", { items: [["", "All expenses"], ["PENDING", "Pending"], ["APPROVED", "Approved"]] }) + field("category", "Category", "select", values.category || "", { items: [["", "All categories"], ...categories.map((value) => [value, label(value)])] }) : field("status", "Payment status", "select", values.status || "", { items: [["", "All invoices"], ...["UNPAID", "PARTIAL", "PAID", "OVERDUE"].map((value) => [value, label(value)])] })}
    ${buttons()}</form><div class="grid min-w-0 gap-3 md:grid-cols-2">${data.map((record) => `<a href="#${type}/${record.id}" class="card block min-w-0 break-words"><h2 class="font-semibold text-forest-700">${esc(expense ? record.description : record.product)}</h2><p class="mt-2 text-lg font-semibold">${esc(money(expense ? record.amount : record.totalAmount, record.currency))}</p><p class="mt-2 text-sm">${expense ? (record.approvedAt ? "Approved - included in profit" : "Pending - excluded from profit") : `${esc(label(record.paymentStatus))} - outstanding ${esc(money(record.balance, record.currency))}`}</p><p class="mt-2 text-xs text-slate-500">${esc(date(expense ? record.expenseDate : record.soldAt))} - ${esc(record.farm?.name || "General workspace")}</p>${!expense ? `<p class="mt-2 break-words text-xs">${esc(record.invoiceNumber)} - ${esc(record.buyer?.name || "Previous buyer")}</p>` : ""}<p class="mt-3 text-xs font-semibold text-forest-700">View details</p></a>`).join("") || '<div class="card text-sm text-slate-500">No records match these filters.</div>'}</div>`;
  root.querySelector("[data-add]").onclick = () => expense ? openExpenseModal() : openSaleModal();
  root.querySelector("[data-filters]").onsubmit = async (event) => {
    event.preventDefault(); listFilters[type] = Object.fromEntries(new FormData(event.currentTarget));
    try { await renderList(type); } catch (error) { context.showToast(error.message, "error"); }
  };
  root.querySelector("[data-reset]").onclick = async () => {
    listFilters[type] = {};
    try { await renderList(type); } catch (error) { context.showToast(error.message, "error"); }
  };
}
export const renderExpenses = (id) => renderList("expenses", id);
export const renderSales = (id) => renderList("sales", id);
export async function renderFinance() {
  const farms = await context.loadAll("/farms");
  const response = await api.get(`/finance?${params(summaryFilters)}`);
  const user = context.getUser();
  const legacy = (await offlineStore.pending()).filter((op) => op.identity === `${user.organization.id}:${user.user.id}` && /^\/(expenses|sales|finance)(\/|\?|$)/.test(op.path));
  const root = document.querySelector("#content");
  const metric = (title, amount, code) => `<div class="rounded-xl bg-slate-50 p-3"><p class="text-xs text-slate-500">${esc(title)}</p><p class="mt-2 break-words text-lg font-semibold">${esc(money(amount, code))}</p></div>`;
  root.innerHTML = `<h1 class="text-2xl font-semibold">Finance</h1><p class="mt-2 text-sm text-slate-500">Profit = invoiced revenue minus owner-approved expenses. Pending expenses are excluded. Currencies are summarized separately; no exchange-rate conversion.</p>
    <div class="my-4 flex flex-wrap gap-2"><a href="#expenses" class="btn-secondary">Expenses</a><a href="#sales" class="btn-secondary">Sales & payments</a></div>
    <form data-filters class="card mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${commonFilters(summaryFilters, farms)}${buttons()}</form>
    <p class="mb-4 text-xs text-slate-500">Revenue/expenses use sale/expense dates. Collected uses payment receipt dates, including older invoices. Outstanding is the current balance of invoices sold in the selected period, not a historical closing balance. Approval is current status, not a historical approval-date ledger.</p>
    <div class="space-y-5">${response.data.map((summary) => `<section class="card min-w-0"><h2 class="text-lg font-semibold">${esc(summary.currency)} summary</h2><div class="mt-4 grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3">${metric("Invoiced revenue", summary.revenue, summary.currency)}${metric("Approved expenses", summary.approvedExpenses, summary.currency)}${metric("Profit (approved basis)", summary.profit, summary.currency)}${metric("Pending expenses", summary.pendingExpenses, summary.currency)}${metric("Payments collected", summary.collected, summary.currency)}${metric("Current outstanding", summary.outstanding, summary.currency)}</div><p class="mt-4 text-sm">${summary.invoiceCount} invoices / ${summary.approvedExpenseCount} approved expenses / ${summary.pendingExpenseCount} pending expenses</p><h3 class="mt-5 text-sm font-semibold">Expense breakdown</h3><div class="mt-3 space-y-2">${summary.expenseCategories.map((category) => `<p class="break-words text-sm">${esc(label(category.category))}: approved ${esc(money(category.approved, summary.currency))}; pending ${esc(money(category.pending, summary.currency))}</p>`).join("") || '<p class="text-sm text-slate-500">No expenses in this period.</p>'}</div></section>`).join("") || '<div class="card text-sm text-slate-500">No financial records in this period.</div>'}</div>
    ${legacy.length ? `<section class="card mt-5"><h2 class="font-semibold text-amber-800">Review older offline financial changes</h2><p class="mt-2 text-sm">These changes were saved by an older release and have not been automatically replayed. Check current records first. If still needed, record them online, then discard the old queued copy.</p>${legacy.map((op) => `<article class="mt-3 min-w-0 rounded-xl border p-3"><p class="break-words text-sm">${esc(op.method)} ${esc(op.path)}</p><pre class="mt-2 whitespace-pre-wrap break-all text-xs">${esc(op.body || "")}</pre><button data-discard="${op.id}" class="btn-secondary mt-3">Discard reviewed queued copy</button></article>`).join("")}</section>` : ""}`;
  root.querySelector("[data-filters]").onsubmit = async (event) => {
    event.preventDefault(); summaryFilters = Object.fromEntries(new FormData(event.currentTarget));
    try { await renderFinance(); } catch (error) { context.showToast(error.message, "error"); }
  };
  root.querySelector("[data-reset]").onclick = async () => {
    summaryFilters = {};
    try { await renderFinance(); } catch (error) { context.showToast(error.message, "error"); }
  };
  root.querySelectorAll("[data-discard]").forEach((button) => button.onclick = async () => {
    if (!confirm("Discard this reviewed offline copy? This does not change server financial records.")) return;
    try { await offlineStore.remove(Number(button.dataset.discard)); context.outboxChanged(); await renderFinance(); }
    catch (error) { context.showToast(error.message, "error"); }
  });
}
