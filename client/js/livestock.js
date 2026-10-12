import { api } from "./api.js?v=0.5.0";
import { field, modal } from "./v03.js?v=0.5.0";
import { localDateTime } from "./reports.js?v=0.5.0";

let context;
export function configureLivestock(value) { context = value; }
const esc = (value) => context.escapeHtml(value);
const label = (value) => String(value).toLowerCase().replaceAll("_", " ");
const date = (value) => value ? new Date(value).toLocaleDateString() : "Not set";
const title = (record) => record.identifier || `${label(record.species)} ${record.id.slice(0, 8)}`;
const speciesItems = ["GOAT", "SHEEP", "POULTRY"].map((value) => [value, label(value)]);
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
      field("species", "Species", "select", record.species || "GOAT", { items: speciesItems }) +
      field("trackingMode", "Tracking mode", "select", record.trackingMode || "INDIVIDUAL", { items: [["INDIVIDUAL", "Individual animal"], ["BATCH", "Batch / flock / herd"]] }) +
      field("identifier", "Animal ID / batch number", "text", record.identifier || "", { maxlength: 200 }) +
      field("breed", "Breed", "text", record.breed || "", { maxlength: 200 }) +
      field("quantity", "Living quantity", "number", record.quantity ?? 1, { required: true }) +
      field("birthDate", "Birth / hatch date (if known)", "date", day(record.birthDate)) +
      (!editing ? field("healthStatus", "Initial health", "select", "HEALTHY", { items: healthItems }) + field("weightKg", "Initial weight per animal (kg)", "number") + field("lastVaccinated", "Previous vaccination date (if known)", "date") : "") +
      '</div>' + field("notes", "Profile notes", "textarea", record.notes || "") +
      `<p class="text-xs text-slate-500">Use history records for health, weight and vaccination updates. Mortality automatically reduces living quantity. ${editing ? "Quantity, farm, species and tracking mode lock once history exists." : "Individuals have quantity 1; a batch can contain any number of animals."}</p>`,
      async (values) => {
        const payload = { farmId: values.farmId, species: values.species, trackingMode: values.trackingMode, identifier: values.identifier || null, breed: values.breed || null, birthDate: values.birthDate || null, notes: values.notes || null };
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
  const types = ["HEALTH", "VACCINATION", "WEIGHT", "MORTALITY", ...(record.species === "POULTRY" ? ["FEED", "EGG_PRODUCTION"] : [])];
  const form = modal("Record livestock activity", field("type", "Record type", "select", "HEALTH", { items: types.map((value) => [value, label(value)]) }) +
    field("occurredAt", "Observed date and time", "datetime-local", localDateTime(), { required: true }) +
    '<div data-event-fields class="space-y-4"></div>' + field("notes", "Notes / treatment details", "textarea") +
    '<p class="text-xs text-slate-500">History is append-only. Check the quantity and date before saving; mortality cannot exceed the remaining living animals.</p>',
    (values) => {
      const payload = { type: values.type, occurredAt: new Date(values.occurredAt).toISOString(), notes: values.notes || null, requestId };
      for (const name of ["title", "healthStatus"]) if (values[name] !== undefined) payload[name] = values[name];
      for (const name of ["quantity", "weightKg", "feedKg"]) if (values[name] !== undefined) payload[name] = Number(values[name]);
      if (values.nextDueAt) payload.nextDueAt = values.nextDueAt;
      return api.post(`/livestock/${record.id}/events`, payload);
    });
  const updateFields = () => {
    const type = form.elements.type.value;
    let markup = "";
    if (["HEALTH", "VACCINATION", "MORTALITY", "FEED"].includes(type)) markup += field("title", { HEALTH: "Observation / diagnosis", VACCINATION: "Vaccine name", MORTALITY: "Cause / reason (unknown if not known)", FEED: "Feed name" }[type], "text", "", { required: true, maxlength: 200 });
    if (type === "HEALTH") markup += field("healthStatus", "Observed health status", "select", record.healthStatus === "DECEASED" ? "HEALTHY" : record.healthStatus, { items: healthItems });
    if (["MORTALITY", "VACCINATION", "EGG_PRODUCTION"].includes(type)) markup += field("quantity", type === "EGG_PRODUCTION" ? "Eggs collected" : type === "MORTALITY" ? "Deaths" : "Animals vaccinated", "number", type === "VACCINATION" ? record.quantity : 1, { required: true });
    if (type === "VACCINATION") markup += field("nextDueAt", "Next vaccination date (optional)", "date");
    if (type === "WEIGHT") markup += field("weightKg", record.trackingMode === "BATCH" ? "Average weight per animal (kg)" : "Weight (kg)", "number", "", { required: true });
    if (type === "FEED") markup += field("feedKg", "Feed consumed (kg)", "number", "", { required: true });
    form.querySelector("[data-event-fields]").innerHTML = markup;
    for (const name of ["quantity", "weightKg", "feedKg"]) {
      const control = form.elements[name];
      if (!control) continue;
      control.min = name === "quantity" ? "1" : "0.001";
      if (name === "quantity") { control.step = "1"; control.max = type === "EGG_PRODUCTION" ? "100000" : String(record.quantity); }
    }
  };
  form.elements.type.addEventListener("change", updateFields);
  updateFields();
}

function stat(name, value) {
  return `<div class="rounded-xl bg-slate-50 p-3"><p class="text-xs text-slate-500">${esc(name)}</p><p class="mt-1 break-words text-lg font-semibold">${esc(value)}</p></div>`;
}

async function renderDetail(id) {
  const [response, events] = await Promise.all([api.get(`/livestock/${id}`), context.loadAll(`/livestock/${id}/events`)]);
  const record = response.data;
  record._count = { events: events.length };
  const age = record.birthDate ? `${Math.floor((Date.now() - new Date(record.birthDate)) / 86400000)} days` : "Unknown";
  const root = document.querySelector("#content");
  root.innerHTML = `<a class="text-sm font-medium text-forest-700" href="#livestock">Back to livestock</a><div class="my-5 flex flex-wrap items-start justify-between gap-3"><div class="min-w-0"><h1 class="break-words text-2xl font-semibold">${esc(title(record))}</h1><p class="mt-2 text-sm text-slate-500">${esc(record.farm.name)} - ${esc(label(record.species))} - ${esc(label(record.trackingMode))}</p></div><div class="flex flex-wrap gap-2"><button data-edit class="btn-secondary">Edit profile</button>${record.quantity > 0 ? '<button data-event class="btn-primary">Record activity</button>' : ""}<button data-archive class="btn-secondary">Archive</button></div></div><section class="card"><div class="grid grid-cols-2 gap-3 sm:grid-cols-3">${stat("Living / initial", `${record.quantity} / ${record.initialQuantity}`)}${stat("Health", label(record.healthStatus))}${stat("Weight per animal", record.weightKg ? `${record.weightKg} kg` : "Not recorded")}${stat("Breed", record.breed || "Unknown")}${stat("Age", age)}${stat("Last vaccination", date(record.lastVaccinated))}${stat("Recorded deaths", record.totals.mortality)}${record.species === "POULTRY" ? stat("Feed consumed", `${Number(record.totals.feedKg.toFixed(3))} kg`) + stat("Eggs collected", record.totals.eggs) : ""}</div>${record.notes ? `<p class="mt-4 whitespace-pre-wrap break-words text-sm">${esc(record.notes)}</p>` : ""}</section><h2 class="mb-3 mt-6 text-lg font-semibold">Livestock history</h2><div class="space-y-3">${events.map((event) => {
    const amounts = [event.quantity !== null ? `${event.quantity} ${event.type === "EGG_PRODUCTION" ? "eggs" : event.type === "MORTALITY" ? "deaths" : "animals"}` : "", event.weightKg !== null ? `${event.weightKg} kg per animal` : "", event.feedKg !== null ? `${event.feedKg} kg feed` : "", event.healthStatus ? label(event.healthStatus) : ""].filter(Boolean).join(" - ");
    return `<article class="card min-w-0"><div class="flex flex-wrap justify-between gap-2"><h3 class="min-w-0 break-words font-semibold">${esc(label(event.type))}${event.title ? `: ${esc(event.title)}` : ""}</h3><time class="text-xs text-slate-500">${esc(new Date(event.occurredAt).toLocaleString())}</time></div><p class="mt-2 text-sm">${esc(amounts)}</p>${event.nextDueAt ? `<p class="mt-2 text-sm">Next due: ${esc(date(event.nextDueAt))}</p>` : ""}${event.notes ? `<p class="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">${esc(event.notes)}</p>` : ""}</article>`;
  }).join("") || '<div class="card text-sm text-slate-500">No history yet. Record a health observation, vaccination, weight or mortality.</div>'}</div>`;
  root.querySelector("[data-edit]").onclick = () => openLivestockModal(record);
  root.querySelector("[data-event]")?.addEventListener("click", () => openEventModal(record));
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
    root.querySelector("[data-records]").innerHTML = items.map((record) => `<a href="#livestock/${record.id}" class="card block min-w-0 text-slate-800 transition hover:border-forest-500"><div class="flex flex-wrap justify-between gap-2"><h2 class="min-w-0 max-w-full break-words font-semibold">${esc(title(record))}</h2><span class="text-sm">${esc(label(record.species))}</span></div><p class="mt-2 break-words text-sm text-slate-500">${esc(record.farm.name)} - ${esc(label(record.trackingMode))}</p><div class="mt-3 grid grid-cols-2 gap-3">${stat("Living animals", record.quantity)}${stat("Health", label(record.healthStatus))}</div><p class="mt-3 text-xs text-forest-700">View profile and history</p></a>`).join("") || '<div class="card">No livestock records match these filters.</div>';
  };
  root.querySelector("[data-new]").onclick = () => openLivestockModal();
  root.querySelectorAll("select").forEach((control) => control.addEventListener("change", update));
  update();
}
