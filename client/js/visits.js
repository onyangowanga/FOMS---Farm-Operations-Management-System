import { api } from "./api.js?v=0.13.0";
import { field, modal } from "./v03.js?v=0.13.0";

let context;
export function configureVisits(value) { context = value; }
const esc = (value) => context.escapeHtml(value);
const isManager = (user) => ["OWNER", "MANAGER"].includes(user.role);
const dayMs = 24 * 60 * 60 * 1000;
const dateInput = (date) => {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
};
const toIso = (value) => new Date(`${value}T08:00`).toISOString();
const longDate = (value) => new Date(value).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const tones = { SCHEDULED: "bg-forest-50 text-forest-700", REQUESTED: "bg-amber-50 text-amber-700", COMPLETED: "bg-sky-50 text-sky-700", CANCELLED: "bg-slate-100 text-slate-500" };
const badge = (visit) => {
  const overdue = ["SCHEDULED", "REQUESTED"].includes(visit.status) && new Date(visit.scheduledFor).getTime() < Date.now() - dayMs;
  return `<span class="inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${overdue ? "bg-rose-50 text-rose-700" : tones[visit.status]}">${overdue ? "overdue" : visit.status.toLowerCase()}</span>`;
};
const relative = (value) => {
  const days = Math.round((new Date(value).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / dayMs);
  return days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : days > 0 ? `in ${days} days` : `${-days} days ago`;
};
const farmItems = (farms) => [["", "Any / all farms"], ...farms.map((farm) => [farm.id, farm.name])];

function visitCard(visit, user) {
  const open = ["SCHEDULED", "REQUESTED"].includes(visit.status);
  const mine = user.role === "AGRONOMIST";
  return `<article class="rounded-xl border border-slate-100 p-4"><div class="flex flex-wrap items-start justify-between gap-2"><div class="min-w-0"><p class="font-semibold">${esc(longDate(visit.scheduledFor))}${open ? ` <span class="text-xs font-normal text-slate-500">(${relative(visit.scheduledFor)})</span>` : ""}</p><p class="mt-1 text-sm text-slate-500">${esc(visit.farm?.name || "All farms")}${mine ? "" : ` · ${esc(visit.agronomist.name)}`}${visit.source === "MANAGER" ? " · requested by management" : ""}</p></div>${badge(visit)}</div>
    ${visit.purpose ? `<p class="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">${esc(visit.purpose)}</p>` : ""}
    ${visit.findings ? `<div class="mt-3 rounded-lg bg-slate-50 p-3"><p class="text-xs font-semibold text-slate-500">Findings${visit.completedAt ? ` · ${esc(longDate(visit.completedAt))}` : ""}</p><p class="mt-1 whitespace-pre-wrap break-words text-sm">${esc(visit.findings)}</p></div>` : ""}
    ${visit.cancelReason ? `<p class="mt-2 text-sm text-slate-500">Cancelled: ${esc(visit.cancelReason)}</p>` : ""}
    ${open ? `<div class="mt-3 flex flex-wrap gap-2">${mine ? `<button data-complete="${visit.id}" class="btn-primary">Complete visit</button>` : ""}<button data-reschedule="${visit.id}" class="btn-secondary">Reschedule</button><button data-cancel="${visit.id}" class="btn-secondary">Cancel</button></div>` : ""}</article>`;
}

function scheduleModal(user, farms, agronomists) {
  const manager = isManager(user);
  if (manager && !agronomists.length) return context.showToast("Add an agronomist to the team before requesting visits.", "error");
  modal(manager ? "Request an agronomist visit" : "Schedule a farm visit",
    (manager ? field("agronomistId", "Agronomist", "select", agronomists[0]?.id, { required: true, items: agronomists.map((person) => [person.id, person.name]) }) : "") +
    field("scheduledFor", "Visit date", "date", dateInput(Date.now() + 7 * dayMs), { required: true }) +
    field("farmId", "Farm", "select", "", { items: farmItems(farms) }) +
    field("purpose", manager ? "Reason / what should be checked" : "Purpose (optional)", "textarea", "", { maxlength: 2000 }) +
    (manager ? '<p class="text-xs text-slate-500">The agronomist is notified immediately and reminded a day before the visit.</p>' : '<p class="text-xs text-slate-500">You will get a reminder a day before. The owner and managers are notified.</p>'),
    (values) => api.post("/visits", { ...values, scheduledFor: toIso(values.scheduledFor), farmId: values.farmId || null, purpose: values.purpose || null }));
}

function completeModal(visit, farms) {
  const form = modal("Complete visit",
    `<p class="text-sm text-slate-500">${esc(longDate(visit.scheduledFor))} · ${esc(visit.farm?.name || "All farms")}</p>` +
    field("findings", "Findings and recommendations", "textarea", "", { required: true, maxlength: 5000 }) +
    field("nextVisitDate", "Next visit date", "date", dateInput(Date.now() + 7 * dayMs), { required: true }) +
    '<p data-next-hint class="text-xs text-slate-500">Visits are expected at least once a week. You will be reminded before the next visit.</p>' +
    field("nextFarmId", "Next visit farm", "select", visit.farmId || "", { items: farmItems(farms) }) +
    field("nextPurpose", "Plan for next visit (optional)", "textarea", "", { maxlength: 2000 }),
    (values) => api.post(`/visits/${visit.id}/complete`, { findings: values.findings, nextVisitDate: toIso(values.nextVisitDate), nextFarmId: values.nextFarmId || null, nextPurpose: values.nextPurpose || null }));
  const input = form.querySelector('[name="nextVisitDate"]');
  const hint = form.querySelector("[data-next-hint]");
  input.min = dateInput(Date.now() + dayMs);
  input.addEventListener("change", () => {
    const days = Math.round((new Date(`${input.value}T08:00`) - Date.now()) / dayMs);
    hint.className = `text-xs ${days > 7 ? "text-amber-700" : "text-slate-500"}`;
    hint.textContent = days > 7 ? `That is ${days} days away — longer than the usual weekly visit.` : "Visits are expected at least once a week. You will be reminded before the next visit.";
  });
}

function rescheduleModal(visit, farms) {
  modal("Reschedule visit",
    field("scheduledFor", "New visit date", "date", dateInput(visit.scheduledFor), { required: true }) +
    field("farmId", "Farm", "select", visit.farmId || "", { items: farmItems(farms) }) +
    field("purpose", "Purpose", "textarea", visit.purpose || "", { maxlength: 2000 }),
    (values) => api.patch(`/visits/${visit.id}`, { scheduledFor: toIso(values.scheduledFor), farmId: values.farmId || null, purpose: values.purpose || null }));
}

function cancelModal(visit) {
  modal("Cancel visit", field("reason", "Reason for cancelling", "textarea", "", { required: true, maxlength: 500 }),
    (values) => api.post(`/visits/${visit.id}/cancel`, { reason: values.reason }));
}

export async function renderVisits() {
  const user = context.getUser();
  const content = document.querySelector("#content");
  content.innerHTML = '<div class="flex min-h-64 items-center justify-center text-sm text-slate-400">Loading visits…</div>';
  const [upcoming, history, farms, agronomists] = await Promise.all([
    api.get("/visits?status=OPEN&limit=100"), api.get("/visits?status=CLOSED&limit=30"),
    context.loadAll("/farms"), isManager(user) ? api.get("/visits/agronomists").then((response) => response.data) : Promise.resolve([])
  ]);
  const next = upcoming.meta.next;
  const past = history.data;
  const lastDone = past.find((visit) => visit.status === "COMPLETED");
  content.innerHTML = `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p class="text-sm font-medium text-forest-600">FARM OPERATIONS</p><h1 class="mt-1 text-2xl font-semibold tracking-tight">Agronomist visits</h1><p class="mt-2 text-sm text-slate-500">${isManager(user) ? "Track agronomist visits, findings and request a visit when you need one." : "Record each visit's findings and set the date of your next visit."}</p></div><button id="new-visit" class="btn-primary">${isManager(user) ? "Request a visit" : "Schedule a visit"}</button></div>
    <div class="mb-5 grid gap-3 sm:grid-cols-3">
      <section class="card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Next visit</p>${next ? `<p class="mt-2 text-lg font-semibold">${esc(longDate(next.scheduledFor))}</p><p class="mt-1 text-sm text-slate-500">${relative(next.scheduledFor)} · ${esc(next.farm?.name || "All farms")}${isManager(user) ? ` · ${esc(next.agronomist.name)}` : ""}</p>` : '<p class="mt-2 text-sm text-amber-700">No visit scheduled.</p>'}</section>
      <section class="card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Upcoming</p><p class="mt-2 text-lg font-semibold">${upcoming.meta.total}</p><p class="mt-1 text-sm text-slate-500">${upcoming.data.filter((visit) => visit.status === "REQUESTED").length} requested by management</p></section>
      <section class="card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Last completed</p>${lastDone ? `<p class="mt-2 text-lg font-semibold">${esc(longDate(lastDone.completedAt || lastDone.scheduledFor))}</p><p class="mt-1 text-sm text-slate-500">${esc(lastDone.farm?.name || "All farms")}</p>` : '<p class="mt-2 text-sm text-slate-500">No completed visits yet.</p>'}</section>
    </div>
    <div class="grid gap-5 xl:grid-cols-2">
      <section class="card"><h2 class="font-semibold">Upcoming visits</h2><div class="mt-4 space-y-3">${upcoming.data.map((visit) => visitCard(visit, user)).join("") || '<p class="text-sm text-slate-500">No upcoming visits.</p>'}</div></section>
      <section class="card"><h2 class="font-semibold">Visit history</h2><div class="mt-4 space-y-3">${past.map((visit) => visitCard(visit, user)).join("") || '<p class="text-sm text-slate-500">Completed and cancelled visits will appear here.</p>'}</div></section>
    </div>`;
  const byId = (id) => upcoming.data.find((visit) => visit.id === id);
  content.querySelector("#new-visit").onclick = () => scheduleModal(user, farms, agronomists);
  content.querySelectorAll("[data-complete]").forEach((button) => button.onclick = () => completeModal(byId(button.dataset.complete), farms));
  content.querySelectorAll("[data-reschedule]").forEach((button) => button.onclick = () => rescheduleModal(byId(button.dataset.reschedule), farms));
  content.querySelectorAll("[data-cancel]").forEach((button) => button.onclick = () => cancelModal(byId(button.dataset.cancel)));
}
