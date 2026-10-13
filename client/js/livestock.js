import { api } from "./api.js?v=0.13.0";
import { field, modal } from "./v03.js?v=0.13.0";
import { localDateTime } from "./reports.js?v=0.13.0";

let context;
export function configureLivestock(value) { context = value; }
const esc = (value) => context.escapeHtml(value);
const label = (value) => String(value).toLowerCase().replaceAll("_", " ");
const date = (value) => value ? new Date(value).toLocaleDateString() : "Not set";
const title = (record) => record.identifier || `${label(record.species)} ${record.id.slice(0, 8)}`;
const poultryLike = ["POULTRY", "DUCK", "TURKEY", "QUAIL", "GUINEA_FOWL"];
const presetSpecies = ["GOAT", "SHEEP", "POULTRY", "CATTLE", "PIG", "RABBIT", "DONKEY", "DUCK", "TURKEY", "FISH"];
const speciesItems = presetSpecies.map((value) => [value, label(value)]);
const healthItems = ["HEALTHY", "UNDER_TREATMENT", "SICK"].map((value) => [value, label(value)]);
const day = (value) => value ? new Date(value).toISOString().slice(0, 10) : "";

export async function openLivestockModal(record = {}) {
  try {
    const farms = await context.loadAll("/farms");
    const editing = Boolean(record.id);
    const historyLocked = Boolean(record._count?.events);
    const quantityLocked = historyLocked || record.quantity === 0 || record.quantity < record.initialQuantity;
    const form = modal(editing ? "Edit livestock profile" : "Add livestock", '<div class="grid gap-4 sm:grid-cols-2">' +
      field("farmId", "Farm", "select", record.farmId, { required: true, items: [["", "Select a farm"], ...farms.map((farm) => [farm.id, farm.name])] }) +
      field("species", "Animal type", "select", !record.species ? "GOAT" : presetSpecies.includes(record.species) ? record.species : "OTHER", { items: [...speciesItems, ["OTHER", "Other (type the name)"]] }) +
      field("customSpecies", "Animal type name", "text", presetSpecies.includes(record.species) ? "" : label(record.species || ""), { maxlength: 40 }) +
      field("trackingMode", "Tracking mode", "select", record.trackingMode || "INDIVIDUAL", { items: [["INDIVIDUAL", "Individual animal"], ["BATCH", "Batch / flock / herd"]] }) +
      field("identifier", "Animal ID / batch number", "text", record.identifier || "", { maxlength: 200 }) +
      field("breed", "Breed", "text", record.breed || "", { maxlength: 200 }) +
      field("quantity", "Living quantity", "number", record.quantity ?? 1, { required: true }) +
      field("birthDate", "Birth / hatch date (if known)", "date", day(record.birthDate)) +
      (!editing ? field("healthStatus", "Initial health", "select", "HEALTHY", { items: healthItems }) + field("weightKg", "Initial weight per animal (kg)", "number") + field("lastVaccinated", "Previous vaccination date (if known)", "date") : "") +
      '</div>' + field("notes", "Profile notes", "textarea", record.notes || "") +
      `<p class="text-xs text-slate-500">Use history records for health, weight and vaccination updates. Mortality automatically reduces living quantity. ${editing ? "Quantity, farm, species and tracking mode lock once history exists." : "Individuals have quantity 1; a batch can contain any number of animals."}</p>`,
      async (values) => {
        const payload = { farmId: values.farmId, species: values.species === "OTHER" ? (values.customSpecies || "").trim() : values.species, trackingMode: values.trackingMode, identifier: values.identifier || null, breed: values.breed || null, birthDate: values.birthDate || null, notes: values.notes || null };
        if (!quantityLocked) payload.quantity = Number(values.quantity);
        if (!editing) Object.assign(payload, { healthStatus: values.healthStatus, weightKg: values.weightKg ? Number(values.weightKg) : null, lastVaccinated: values.lastVaccinated || null });
        return editing ? api.patch(`/livestock/${record.id}`, payload) : api.post("/livestock", payload);
      });
    if (historyLocked) for (const name of ["farmId", "species", "trackingMode"]) {
      // Disabled selects are omitted from FormData; hidden inputs retain their locked values.
      const control = form.elements[name];
      control.disabled = true;
      const hidden = document.createElement("input");
      hidden.type = "hidden"; hidden.name = name; hidden.value = record[name];
      form.append(hidden);
    }
    const syncSpecies = () => { const other = form.elements.species.value === "OTHER"; form.elements.customSpecies.closest("label").hidden = !other; form.elements.customSpecies.required = other; };
    form.elements.species.addEventListener("change", syncSpecies);
    syncSpecies();
    form.elements.quantity.step = "1";
    form.elements.quantity.max = "100000";
    const updateMode = () => {
      const mode = form.querySelector('[name="trackingMode"]').value;
      form.elements.quantity.readOnly = quantityLocked || mode === "INDIVIDUAL";
      form.elements.quantity.min = quantityLocked ? "0" : "1";
      if (!quantityLocked && mode === "INDIVIDUAL") form.elements.quantity.value = "1";
    };
    form.querySelector('[name="trackingMode"]').addEventListener("change", updateMode);
    updateMode();
    form.elements.birthDate.max = day(new Date());
  } catch (error) { context.showToast(error.message, "error"); }
}

function openEventModal(record) {
  const requestId = crypto.randomUUID();
  const types = record.quantity > 0
    ? ["HEALTH", "VACCINATION", "WEIGHT", "MORTALITY", "PURCHASE", "BREEDING", "SALE",
      ...(record.trackingMode === "BATCH" ? ["BIRTH"] : []), ...(poultryLike.includes(record.species) ? ["FEED", "EGG_PRODUCTION"] : [])]
    : record.trackingMode === "BATCH" ? ["PURCHASE"] : [];
  const form = modal("Record livestock activity", field("type", "Record type", "select", "HEALTH", { items: types.map((value) => [value, label(value)]) }) +
    field("occurredAt", "Observed date and time", "datetime-local", localDateTime(), { required: true }) +
    '<div data-event-fields class="space-y-4"></div>' + field("notes", "Notes / treatment details", "textarea") +
    '<p class="text-xs text-slate-500">History is append-only. Check the quantity and date before saving; mortality cannot exceed the remaining living animals.</p>',
    (values) => {
      const payload = { type: values.type, occurredAt: new Date(values.occurredAt).toISOString(), notes: values.notes || null, requestId };
      for (const name of ["title", "healthStatus", "supplier", "currency"]) if (values[name] !== undefined) payload[name] = values[name];
      for (const name of ["quantity", "weightKg", "feedKg", "amount"]) if (values[name] !== undefined) payload[name] = Number(values[name]);
      if (payload.type === "PURCHASE") payload.supplier = values.supplier || null;
      if (values.nextDueAt) payload.nextDueAt = values.nextDueAt;
      return api.post(`/livestock/${record.id}/events`, payload);
    });
  const updateFields = () => {
    const type = form.elements.type.value;
    let markup = "";
    if (["HEALTH", "VACCINATION", "MORTALITY", "FEED", "PURCHASE"].includes(type)) markup += field("title", { HEALTH: "Observation / diagnosis", VACCINATION: "Vaccine name", MORTALITY: "Cause / reason (unknown if not known)", FEED: "Feed name", PURCHASE: "Purchase description" }[type], "text", "", { required: true, maxlength: 200 });
    if (type === "PURCHASE") markup += '<div class="grid gap-4 sm:grid-cols-2">' + field("supplier", "Supplier (optional)", "text") + field("currency", "Currency", "text", "KES", { required: true, maxlength: 3 }) + field("amount", "Total purchase cost", "number", "", { required: true }) + '</div>';
    if (type === "BREEDING") markup += field("title", "Mate identifier", "text", "", { required: true, maxlength: 200 });
    if (type === "HEALTH") markup += field("healthStatus", "Observed health status", "select", record.healthStatus === "DECEASED" ? "HEALTHY" : record.healthStatus, { items: healthItems });
    if (["MORTALITY", "VACCINATION", "EGG_PRODUCTION", "PURCHASE", "BIRTH", "SALE"].includes(type)) markup += field("quantity", ({ EGG_PRODUCTION: "Eggs collected", MORTALITY: "Deaths", VACCINATION: "Animals vaccinated", PURCHASE: "Animals purchased", BIRTH: "Offspring born", SALE: "Animals sold" })[type], "number", type === "VACCINATION" ? record.quantity : 1, { required: true });
    if (type === "SALE") markup += '<p class="text-xs text-slate-500">Saving this event reduces the living count immediately. Create and link the invoice afterward from the saved sale event; payment can be recorded separately.</p>';
    if (type === "PURCHASE") markup += '<p class="text-xs text-slate-500">The linked expense is created in the same save and remains pending owner approval. Batch counts increase immediately.</p>';
    if (type === "BIRTH" && record.trackingMode === "BATCH") markup += '<p class="text-xs text-slate-500">Births increase the batch living count. For individually tracked offspring, create one separate individual profile per animal.</p>';
    if (type === "BREEDING") markup += '<p class="text-xs text-slate-500">Records the mate identifier and date; no offspring count changes until births are recorded.</p>';
    if (type === "VACCINATION") markup += field("nextDueAt", "Next vaccination date (optional)", "date");
    if (type === "WEIGHT") markup += field("weightKg", record.trackingMode === "BATCH" ? "Average weight per animal (kg)" : "Weight (kg)", "number", "", { required: true });
    if (type === "FEED") markup += field("feedKg", "Feed consumed (kg)", "number", "", { required: true });
    form.querySelector("[data-event-fields]").innerHTML = markup;
    for (const name of ["quantity", "weightKg", "feedKg", "amount"]) {
      const control = form.elements[name];
      if (!control) continue;
      control.min = name === "quantity" ? "1" : "0.001";
      if (name === "quantity") {
        control.step = "1";
        control.max = type === "EGG_PRODUCTION" ? "100000"
          : ["PURCHASE", "BIRTH"].includes(type) && record.trackingMode === "BATCH" ? String(Math.max(0, 100000 - record.initialQuantity))
            : type === "PURCHASE" && record.trackingMode === "INDIVIDUAL" ? "1" : String(record.quantity);
      }
      if (name === "amount") { control.step = "0.01"; control.min = "0.01"; }
    }

  };
  form.elements.type.addEventListener("change", updateFields);
  updateFields();
}

async function openLivestockInvoiceModal(record, event) {
  try {
    const buyers = await api.get("/sales/buyers");
    const requestId = crypto.randomUUID();
    const form = modal("Create invoice for livestock sale",
      `<p class="text-sm">${esc(event.quantity)} ${esc(label(record.species))} - ${esc(title(record))}. The event date and quantity are fixed.</p>` +
      '<div data-new-buyer class="space-y-3">' + field("buyerName", "New buyer name", "text", "", { required: true, maxlength: 120 }) +
      field("buyerPhone", "Buyer phone (optional)", "text", "", { maxlength: 40 }) +
      field("buyerEmail", "Buyer email (optional)", "email") + '</div>' +
      field("buyerId", "Existing buyer (optional)", "select", "", { items: [["", "New buyer"], ...buyers.data.map((buyer) => [buyer.id, buyer.name])] }) +
      '<div class="grid gap-4 sm:grid-cols-2">' + field("unitPrice", "Price per animal", "number", "", { required: true }) +
      field("currency", "Currency", "text", "KES", { required: true, maxlength: 3 }) +
      field("dueDate", "Payment due date (optional)", "date") + '</div>' +
      field("notes", "Invoice notes (optional)", "textarea") +
      '<p class="text-xs text-slate-500">Creates a standard FOMS invoice linked to this sale record. Record payments from the invoice afterward.</p>',
      (values) => api.post(`/sales/livestock-events/${event.id}/invoice`, {
        requestId, unitPrice: Number(values.unitPrice), currency: values.currency,
        dueDate: values.dueDate ? new Date(`${values.dueDate}T23:59:59.999`).toISOString() : null, notes: values.notes || null,
        ...(values.buyerId ? { buyerId: values.buyerId } : { buyer: { name: values.buyerName,
          ...(values.buyerPhone ? { phone: values.buyerPhone } : {}), ...(values.buyerEmail ? { email: values.buyerEmail } : {}) } })
      }));
    form.elements.unitPrice.step = "0.01"; form.elements.unitPrice.min = "0.01";
    form.elements.buyerId.onchange = () => {
      const adding = !form.elements.buyerId.value;
      form.querySelector("[data-new-buyer]").hidden = !adding;
      form.elements.buyerName.required = adding;
    };
  } catch (error) { context.showToast(error.message, "error"); }
}

function stat(name, value) {
  return `<div class="rounded-xl bg-slate-50 p-3"><p class="text-xs text-slate-500">${esc(name)}</p><p class="mt-1 break-words text-lg font-semibold">${esc(value)}</p></div>`;
}

async function renderDetail(id) {
  const [response, events] = await Promise.all([api.get(`/livestock/${id}`), context.loadAll(`/livestock/${id}/events`)]);
  const record = response.data;
  record._count = { events: events.length };
  const age = record.totals.births ? "Mixed ages (births recorded)" : record.birthDate ? `${Math.floor((Date.now() - new Date(record.birthDate)) / 86400000)} days` : "Unknown";
  const health = record.quantity === 0 ? "No living animals" : record.healthStatus === "DECEASED" && record.totals.purchases ? "Restocked; record current health" : label(record.healthStatus);
  const root = document.querySelector("#content");
  root.innerHTML = `<a class="text-sm font-medium text-forest-700" href="#livestock">Back to livestock</a><div class="my-5 flex flex-wrap items-start justify-between gap-3"><div class="min-w-0"><h1 class="break-words text-2xl font-semibold">${esc(title(record))}</h1><p class="mt-2 text-sm text-slate-500">${esc(record.farm.name)} - ${esc(label(record.species))} - ${esc(label(record.trackingMode))}</p></div><div class="flex flex-wrap gap-2"><button data-edit class="btn-secondary">Edit profile</button>${record.quantity > 0 || record.trackingMode === "BATCH" ? '<button data-event class="btn-primary">Record activity / purchase</button>' : ""}<button data-archive class="btn-secondary">Archive</button></div></div><section class="card"><div class="grid grid-cols-2 gap-3 sm:grid-cols-3">${stat("Living / total recorded additions", `${record.quantity} / ${record.initialQuantity}`)}${stat("Current status", health)}${stat("Weight per animal", record.weightKg ? `${record.weightKg} kg` : "Not recorded")}${stat("Breed", record.breed || "Unknown")}${stat("Age", age)}${stat("Last vaccination", date(record.lastVaccinated))}${stat("Recorded deaths", record.totals.mortality)}${stat("Births", record.totals.births)}${stat("Purchased", record.totals.purchases)}${stat("Sold", record.totals.sales)}${record.species === "POULTRY" ? stat("Feed consumed", `${Number(record.totals.feedKg.toFixed(3))} kg`) + stat("Eggs collected", record.totals.eggs) : ""}</div>${record.notes ? `<p class="mt-4 whitespace-pre-wrap break-words text-sm">${esc(record.notes)}</p>` : ""}</section><h2 class="mb-3 mt-6 text-lg font-semibold">Livestock history</h2><div class="space-y-3">${events.map((event) => {
    const amounts = [event.quantity !== null ? `${event.quantity} ${event.type === "EGG_PRODUCTION" ? "eggs" : event.type === "MORTALITY" ? "deaths" : record.species === "POULTRY" ? "birds" : "animals"}` : "", event.weightKg !== null ? `${event.weightKg} kg per animal` : "", event.feedKg !== null ? `${event.feedKg} kg feed` : "", event.healthStatus ? label(event.healthStatus) : ""].filter(Boolean).join(" - ");
    const purchase = event.purchaseExpense ? `<a class="mt-3 inline-block text-sm text-forest-700" href="#expenses/${event.purchaseExpense.id}">Linked ${event.purchaseExpense.deletedAt ? "archived" : event.purchaseExpense.approvedAt ? "approved" : "pending"} expense · ${esc(event.purchaseExpense.currency)} ${esc(event.purchaseExpense.amount)}</a>` : "";
    const sale = event.saleInvoice ? `<a class="mt-3 inline-block text-sm text-forest-700" href="#sales/${event.saleInvoice.id}">Linked invoice ${esc(event.saleInvoice.invoiceNumber)}</a>`
      : event.type === "SALE" ? `<button data-link-invoice="${event.id}" class="btn-secondary mt-3">Create / link invoice</button>` : "";
    return `<article class="card min-w-0"><div class="flex flex-wrap justify-between gap-2"><h3 class="min-w-0 break-words font-semibold">${esc(label(event.type))}${event.title ? `: ${esc(event.title)}` : ""}</h3><time class="text-xs text-slate-500">${esc(new Date(event.occurredAt).toLocaleString())}</time></div><p class="mt-2 text-sm">${esc(amounts)}</p>${event.nextDueAt ? `<p class="mt-2 text-sm">Next due: ${esc(date(event.nextDueAt))}</p>` : ""}${event.type === "PURCHASE" ? purchase : ""}${sale}${event.notes ? `<p class="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">${esc(event.notes)}</p>` : ""}</article>`;
  }).join("") || '<div class="card text-sm text-slate-500">No history yet. Record a health observation, vaccination, weight or mortality.</div>'}</div>`;
  root.querySelector("[data-edit]").onclick = () => openLivestockModal(record);
  root.querySelector("[data-event]")?.addEventListener("click", () => openEventModal(record));
  root.querySelectorAll("[data-link-invoice]").forEach((button) => {
    const event = events.find((item) => item.id === button.dataset.linkInvoice);
    button.onclick = () => openLivestockInvoiceModal(record, event);
  });
  root.querySelector("[data-archive]").onclick = async () => {
    if (!confirm("Archive this livestock record? Its history is retained, but it will be removed from active lists and daily-report selectors.")) return;
    try {
      const result = await api.delete(`/livestock/${record.id}`);
      context.showToast(result.message);
      await context.navigate("livestock");
    } catch (error) { context.showToast(error.message, "error"); }
  };
}

export async function renderLivestock(id) {
  if (id) return renderDetail(id);
  const [records, farms] = await Promise.all([context.loadAll("/livestock"), context.loadAll("/farms")]);
  const root = document.querySelector("#content");
  root.innerHTML = `<div class="mb-5 flex flex-wrap justify-between gap-3"><div><h1 class="text-2xl font-semibold">Livestock management</h1><p class="mt-2 text-sm text-slate-500">Individual animals and batches, with health and production history.</p></div><button data-new class="btn-primary">Add livestock</button></div><div class="mb-4 grid gap-3 sm:grid-cols-2">${field("filterFarm", "Farm", "select", "", { items: [["", "All farms"], ...farms.map((farm) => [farm.id, farm.name])] })}${field("filterSpecies", "Species", "select", "", { items: [["", "All species"], ...speciesItems] })}</div><div data-summary class="mb-4 grid grid-cols-2 gap-3"></div><div data-records class="grid gap-4 xl:grid-cols-2"></div>`;
  const update = () => {
    const farmId = root.querySelector('[name="filterFarm"]').value;
    const species = root.querySelector('[name="filterSpecies"]').value;
    const items = records.filter((record) => (!farmId || record.farmId === farmId) && (!species || record.species === species));
    root.querySelector("[data-summary]").innerHTML = stat("Records", items.length) + stat("Living animals", items.reduce((sum, record) => sum + record.quantity, 0));
    root.querySelector("[data-records]").innerHTML = items.map((record) => `<a href="#livestock/${record.id}" class="card block min-w-0 text-slate-800 transition hover:border-forest-500"><div class="flex flex-wrap justify-between gap-2"><h2 class="min-w-0 max-w-full break-words font-semibold">${esc(title(record))}</h2><span class="text-sm">${esc(label(record.species))}</span></div><p class="mt-2 break-words text-sm text-slate-500">${esc(record.farm.name)} - ${esc(label(record.trackingMode))}</p><div class="mt-3 grid grid-cols-2 gap-3">${stat("Living animals", record.quantity)}${stat("Health", record.quantity === 0 ? "No living animals" : label(record.healthStatus))}</div><p class="mt-3 text-xs text-forest-700">View profile and history</p></a>`).join("") || '<div class="card">No livestock records match these filters.</div>';
  };
  root.querySelector("[data-new]").onclick = () => openLivestockModal();
  root.querySelectorAll("select").forEach((control) => control.addEventListener("change", update));
  update();
}
