import { api } from "./api.js?v=0.10.0";
import { field, modal } from "./v03.js?v=0.10.0";

let context;
let filters = {};
export function configureInventory(value) { context = value; }
const esc = (value) => context.escapeHtml(value);
const manage = () => ["OWNER", "MANAGER"].includes(context.getUser().role);
const label = (value) => String(value).toLowerCase().replaceAll("_", " ");
const categories = ["SEED", "FERTILIZER", "CHEMICAL", "FEED", "VACCINE", "SUPPLEMENT", "ASSET", "OTHER"];
const conditions = ["WORKING", "NEEDS_REPAIR", "OUT_OF_SERVICE", "RETIRED"];
const date = (value) => value ? new Date(value).toLocaleString() : "Not set";
const qty = (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const localTime = (value) => new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, -1);

export async function openInventoryModal(item = {}) {
  if (!manage()) { context.showToast("Only owners and managers can manage inventory.", "error"); return; }
  try {
    const farms = await context.loadAll("/farms");
    const requestId = crypto.randomUUID();
    const form = modal(item.id ? "Edit inventory item" : "Add inventory item",
      field("name", "Item name", "text", item.name || "", { required: true, maxlength: 120 }) +
      '<div class="grid gap-4 sm:grid-cols-2">' +
      field("category", "Category", "select", item.category || "SEED", { items: categories.map((value) => [value, label(value)]) }) +
      field("trackingMode", "Tracking", "select", item.trackingMode || "BATCH", { items: [["BATCH", "Batch quantity"], ["INDIVIDUAL", "Individual equipment (maintenance)"]] }) +
      field("unit", "Unit (fixed after creation)", "text", item.unit || "", { required: true, maxlength: 30 }) +
      field("sku", "SKU / unique asset ID", "text", item.sku || "", { maxlength: 80 }) +
      (!item.id ? field("quantity", "Opening quantity", "number", 0, { required: true }) : "") +
      field("reorderLevel", "Reorder level", "number", item.reorderLevel ?? 0, { required: true }) +
      field("serialNumber", "Serial number (individual equipment)", "text", item.serialNumber || "", { maxlength: 120 }) +
      field("farmId", "Farm", "select", item.farmId || "", { items: [["", "Central store / all farms"], ...farms.map((farm) => [farm.id, farm.name])] }) +
      '</div>' + field("notes", "Notes", "textarea", item.notes || "") +
      '<p class="text-xs text-slate-500">Use batches for tools that do not need maintenance records. Individual equipment starts as Working with quantity 1 and requires a unique asset ID. Quantities allow up to 3 decimal places. Stock/maintenance records do not automatically create expenses.</p>',
      (values) => {
        const payload = { ...values, farmId: values.farmId || null, sku: values.sku || null, notes: values.notes || null, serialNumber: values.serialNumber || null, reorderLevel: Number(values.reorderLevel) };
        if (item.id) {
          delete payload.category; delete payload.trackingMode; delete payload.unit;
          return api.patch(`/inventory/items/${item.id}`, payload);
        }
        return api.post("/inventory/items", { ...payload, requestId, quantity: Number(values.quantity) });
      });
    const individualControls = () => {
      const individual = form.elements.trackingMode.value === "INDIVIDUAL";
      form.elements.sku.required = individual;
      form.elements.serialNumber.disabled = !individual;
      form.elements.reorderLevel.readOnly = individual;
      if (individual) {
        form.elements.reorderLevel.value = "0";
        if (!item.id) { form.elements.quantity.value = "1"; form.elements.unit.value = "unit"; }
      }
      if (!item.id) { form.elements.quantity.readOnly = individual; form.elements.unit.readOnly = individual; }
    };
    if (item.id) ["category", "trackingMode", "unit"].forEach((name) => { form.elements[name].disabled = true; });
    else {
      form.elements.category.onchange = () => {
        if (form.elements.category.value !== "ASSET") form.elements.trackingMode.value = "BATCH";
        form.elements.trackingMode.disabled = form.elements.category.value !== "ASSET";
        individualControls();
      };
      form.elements.trackingMode.onchange = individualControls;
      form.elements.category.onchange();
    }
    individualControls();
    if (!item.id) form.elements.quantity.step = "0.001";
    form.elements.reorderLevel.step = "0.001";
  } catch (error) { context.showToast(error.message, "error"); }
}
function stockModal(item, type) {
  const requestId = crypto.randomUUID();
  const adjustment = type === "ADJUSTMENT";
  const form = modal(adjustment ? "Reconcile counted stock" : type === "IN" ? "Receive stock" : "Issue stock",
    `<p class="break-words text-sm">${esc(item.name)}: ${qty(item.quantity)} ${esc(item.unit)} currently available.</p>` +
    field("quantity", adjustment ? "Actual counted balance (not a change)" : `Quantity (${item.unit})`, "number", adjustment ? item.quantity : "", { required: true }) +
    field("occurredAt", "Date and time", "datetime-local", localTime(new Date()), { required: true }) +
    (type === "IN" ? field("unitCost", "Unit cost (KES, optional)", "number") : "") +
    field("reference", "Reference", "text", "", { maxlength: 120 }) +
    field("notes", adjustment ? "Reason for correction" : "Notes (optional)", "textarea", "", { required: adjustment }) +
    (adjustment ? '<p class="text-xs text-slate-500">The count replaces the current balance. History keeps the resulting balance and your reason. Check the latest stock before saving.</p>' : ""),
    (values) => api.post(`/inventory/items/${item.id}/movements`, {
      requestId, type, quantity: Number(values.quantity), occurredAt: new Date(values.occurredAt).toISOString(),
      ...(values.unitCost ? { unitCost: Number(values.unitCost) } : {}),
      ...(values.reference ? { reference: values.reference } : {}), ...(values.notes ? { notes: values.notes } : {})
    }));
  form.elements.quantity.step = "0.001";
  form.elements.quantity.min = adjustment ? "0" : "0.001";
  if (form.elements.unitCost) form.elements.unitCost.step = "0.01";
}
function equipmentModal(item) {
  const requestId = crypto.randomUUID();
  modal("Record equipment condition / maintenance",
    `<p class="break-words text-sm">${esc(item.name)} (${esc(item.sku)}). Current condition: ${esc(label(item.assetCondition))}.</p>` +
    field("type", "Record type", "select", "MAINTENANCE", { items: [["MAINTENANCE", "Maintenance / service"], ["CONDITION", "Condition observation"]] }) +
    field("condition", "Condition after this observation", "select", item.assetCondition, { items: conditions.map((value) => [value, label(value)]) }) +
    field("observedAt", "Observation date and time", "datetime-local", localTime(new Date()), { required: true }) +
    field("notes", "Work done / observation / retirement reason", "textarea", "", { required: true }) +
    field("cost", "Cost (KES, optional; not automatically an expense)", "number") +
    field("nextMaintenanceDate", "Next maintenance date and time (optional)", "datetime-local", item.nextMaintenanceDate ? localTime(new Date(item.nextMaintenanceDate)) : "") +
    '<p class="text-xs text-slate-500">History is append-only. Backdated records do not replace newer condition or maintenance dates. Retirement is permanent and removes the equipment from active quantity.</p>',
    (values) => api.post(`/inventory/items/${item.id}/asset-events`, {
      ...values, requestId, observedAt: new Date(values.observedAt).toISOString(),
      cost: values.cost ? Number(values.cost) : undefined,
      nextMaintenanceDate: values.nextMaintenanceDate ? new Date(values.nextMaintenanceDate).toISOString() : null
    }));
}
async function detail(id) {
  const item = (await api.get(`/inventory/items/${id}`)).data;
  const individual = item.trackingMode === "INDIVIDUAL";
  const [movements, events] = await Promise.all([api.get(`/inventory/items/${id}/movements`), individual ? api.get(`/inventory/items/${id}/asset-events`) : Promise.resolve({ data: [] })]);
  const root = document.querySelector("#content");
  const due = individual && item.assetCondition !== "RETIRED" && item.nextMaintenanceDate && new Date(item.nextMaintenanceDate) <= new Date();
  root.innerHTML = `<a href="#inventory" class="text-sm font-medium text-forest-700">Back to inventory</a>
    <div class="my-5 flex flex-wrap justify-between gap-3"><div class="w-full min-w-0 sm:flex-1"><h1 class="break-words text-2xl font-semibold">${esc(item.name)}</h1><p class="mt-2 break-words text-sm text-slate-500">${esc(item.sku || "No SKU")} - ${esc(label(item.category))} - ${esc(item.farm?.name || "Central store / all farms")}</p></div>
    ${manage() ? '<div class="flex flex-wrap gap-2"><button data-edit class="btn-secondary">Edit item</button><button data-archive class="btn-secondary">Archive</button></div>' : ""}</div>
    <section class="card min-w-0 break-words"><p class="text-lg font-semibold">${qty(item.quantity)} ${esc(item.unit)} ${item.lowStock ? '<span class="text-sm text-amber-700">Reorder needed</span>' : ""}</p>
      ${individual ? `<p class="mt-3 text-sm"><strong>Condition:</strong> ${esc(label(item.assetCondition))}</p><p class="mt-2 text-sm"><strong>Serial number:</strong> ${esc(item.serialNumber || "Not set")}</p><p class="mt-2 text-sm ${due ? "text-amber-700" : ""}"><strong>Next maintenance:</strong> ${esc(date(item.nextMaintenanceDate))}${due ? " (due)" : ""}</p>` : `<p class="mt-3 text-sm">Reorder level: ${qty(item.reorderLevel)} ${esc(item.unit)}</p>`}
      ${item.notes ? `<p class="mt-3 whitespace-pre-wrap text-sm">${esc(item.notes)}</p>` : ""}
      ${manage() ? `<div class="mt-4 flex flex-wrap gap-2">${individual ? (item.assetCondition !== "RETIRED" ? '<button data-equipment class="btn-primary">Record maintenance / condition</button>' : '<p class="text-sm text-slate-500">Retired equipment - history retained.</p>') : '<button data-stock="IN" class="btn-primary">Receive stock</button><button data-stock="OUT" class="btn-secondary">Issue stock</button><button data-stock="ADJUSTMENT" class="btn-secondary">Reconcile count</button>'}</div>` : ""}
    </section>
    ${individual ? `<section class="card mt-5 min-w-0"><h2 class="text-lg font-semibold">Equipment history</h2><div class="mt-4 space-y-3">${events.data.map((event) => `<article class="min-w-0 rounded-xl border border-slate-100 p-3"><p class="break-words text-sm font-semibold">${esc(label(event.type))} - ${esc(label(event.condition))}</p><p class="mt-1 break-words text-xs text-slate-500">Observed ${esc(date(event.observedAt))} / recorded ${esc(date(event.createdAt))}</p><p class="mt-2 whitespace-pre-wrap break-words text-sm">${esc(event.notes)}</p>${event.cost !== null ? `<p class="mt-2 text-sm">Cost: KES ${Number(event.cost).toLocaleString()}</p>` : ""}<p class="mt-2 break-words text-xs text-slate-500">Next maintenance: ${esc(date(event.nextMaintenanceDate))}</p></article>`).join("") || '<p class="text-sm text-slate-500">No maintenance or condition records yet.</p>'}</div></section>` : ""}
    <section class="card mt-5 min-w-0"><h2 class="text-lg font-semibold">Stock history</h2><p class="mt-2 text-xs text-slate-500">Newest recorded first. Count adjustments show the actual counted quantity, not a delta. Historical balances before V0.7 were not reconstructed.</p><div class="mt-4 space-y-3">${movements.data.map((movement) => `<article class="min-w-0 rounded-xl border border-slate-100 p-3"><p class="break-words text-sm font-semibold">${movement.type === "ADJUSTMENT" ? "Count correction" : movement.type === "IN" ? "Received" : "Issued"}: ${qty(movement.quantity)} ${esc(item.unit)}</p><p class="mt-1 break-words text-xs text-slate-500">Occurred ${esc(date(movement.occurredAt))} / recorded ${esc(date(movement.createdAt))} by ${esc(movement.creator?.name || "Previous user")}</p>${movement.balanceAfter !== null ? `<p class="mt-2 text-sm">Balance after: ${qty(movement.balanceAfter)} ${esc(item.unit)}</p>` : ""}${movement.unitCost !== null ? `<p class="mt-2 text-sm">Unit cost: KES ${Number(movement.unitCost).toLocaleString()}</p>` : ""}${movement.reference ? `<p class="mt-2 break-words text-sm">Reference: ${esc(movement.reference)}</p>` : ""}${movement.notes ? `<p class="mt-2 whitespace-pre-wrap break-words text-sm">${esc(movement.notes)}</p>` : ""}</article>`).join("") || '<p class="text-sm text-slate-500">No movements yet.</p>'}</div></section>`;
  root.querySelector("[data-edit]")?.addEventListener("click", () => openInventoryModal(item));
  root.querySelectorAll("[data-stock]").forEach((button) => button.onclick = () => stockModal(item, button.dataset.stock));
  root.querySelector("[data-equipment]")?.addEventListener("click", () => equipmentModal(item));
  root.querySelector("[data-archive]")?.addEventListener("click", async (event) => {
    if (!confirm("Archive this zero-stock item? Its stock and equipment history will be retained.")) return;
    event.currentTarget.disabled = true;
    try { const response = await api.delete(`/inventory/items/${id}`); context.showToast(response.message); location.hash = "#inventory"; }
    catch (error) { context.showToast(error.message, "error"); event.currentTarget.disabled = false; }
  });
}
export async function renderInventory(id) {
  if (id) return detail(id);
  const farms = await context.loadAll("/farms");
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  const response = await api.get(`/inventory?${query}`);
  const root = document.querySelector("#content");
  root.innerHTML = `<div class="mb-5 flex flex-wrap justify-between gap-3"><div><h1 class="text-2xl font-semibold">Inventory</h1><p class="mt-2 text-sm text-slate-500">${response.meta.total} matching items - ${response.meta.lowStock} low stock</p></div>${manage() ? '<button data-add class="btn-primary">Add inventory item</button>' : ""}</div>
    <form data-filters class="card mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      ${field("search", "Find name / SKU / serial", "search", filters.search || "")}
      ${field("category", "Category", "select", filters.category || "", { items: [["", "All categories"], ...categories.map((value) => [value, label(value)])] })}
      ${field("trackingMode", "Tracking", "select", filters.trackingMode || "", { items: [["", "All tracking"], ["BATCH", "Batch quantities"], ["INDIVIDUAL", "Individual equipment"]] })}
      ${field("farmId", "Farm", "select", filters.farmId || "", { items: [["", "All farms / central store"], ...farms.map((farm) => [farm.id, farm.name])] })}
      ${field("lowStock", "Stock status", "select", filters.lowStock || "", { items: [["", "All stock"], ["true", "Low stock only"], ["false", "Not low stock"]] })}
      <div class="flex items-end gap-2"><button class="btn-primary">Apply filters</button><button data-reset type="button" class="btn-secondary">Reset</button></div>
    </form><div class="grid min-w-0 gap-3 md:grid-cols-2">${response.data.map((item) => {
      const individual = item.trackingMode === "INDIVIDUAL";
      const due = individual && item.assetCondition !== "RETIRED" && item.nextMaintenanceDate && new Date(item.nextMaintenanceDate) <= new Date();
      return `<a href="#inventory/${item.id}" class="card block min-w-0 break-words ${item.lowStock || due ? "border-amber-200 bg-amber-50" : ""}"><h2 class="font-semibold text-forest-700">${esc(item.name)}</h2><p class="mt-1 text-xs text-slate-500">${esc(item.sku || "No SKU")} - ${esc(label(item.category))}</p><p class="mt-3 text-lg font-semibold">${qty(item.quantity)} ${esc(item.unit)}</p><p class="mt-1 text-sm">${individual ? `Individual equipment - ${esc(label(item.assetCondition))}` : `Batch stock - reorder at ${qty(item.reorderLevel)} ${esc(item.unit)}`}</p><p class="mt-2 text-xs text-slate-500">${esc(item.farm?.name || "Central store / all farms")}</p>${item.lowStock ? '<p class="mt-3 text-sm font-semibold text-amber-800">Low stock - plan a reorder</p>' : ""}${due ? '<p class="mt-3 text-sm font-semibold text-amber-800">Maintenance due</p>' : ""}<p class="mt-3 text-xs font-semibold text-forest-700">View details / history</p></a>`;
    }).join("") || '<div class="card"><p class="text-sm text-slate-500">No inventory items match these filters.</p></div>'}</div>`;
  root.querySelector("[data-add]")?.addEventListener("click", () => openInventoryModal());
  root.querySelector("[data-filters]").onsubmit = async (event) => {
    event.preventDefault(); filters = Object.fromEntries(new FormData(event.currentTarget));
    try { await renderInventory(); } catch (error) { context.showToast(error.message, "error"); }
  };
  root.querySelector("[data-reset]").onclick = async () => {
    filters = {};
    try { await renderInventory(); } catch (error) { context.showToast(error.message, "error"); }
  };
}
