import { api } from "./api.js?v=0.10.0";
import { field } from "./v03.js?v=0.10.0";

let context;
let identity;
let filters = {};
export function configureReporting(value) { context = value; }
const esc = value => context.escapeHtml(value);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const queryString = values => new URLSearchParams(Object.entries(values).filter(([, value]) => value));
function sectionCards(section, start) {
  return section.rows.slice(start, start + 25).map((row, offset) => `<article class="min-w-0 rounded-xl border border-slate-200 p-3"><h3 class="mb-3 text-xs font-semibold text-forest-700">Record ${start + offset + 1}</h3><dl class="grid min-w-0 gap-3 sm:grid-cols-2">${section.columns.map((column, i) => `<div class="min-w-0"><dt class="text-xs text-slate-500">${esc(column)}</dt><dd class="mt-1 whitespace-pre-wrap break-words text-sm">${esc(row[i] ?? "-")}</dd></div>`).join("")}</dl></article>`).join("") || '<p class="text-sm text-slate-500">No matching records.</p>';
}
export async function renderReporting(type) {
  const user = context.getUser();
  const key = `${user.organization.id}:${user.user.id}:${user.role}`;
  if (identity !== key) { filters = {}; identity = key; }
  const values = filters[type] || { period: "MONTHLY", date: today() };
  const [farms, response] = await Promise.all([context.loadAll("/farms"), api.get(`/reporting/${type}?${queryString(values)}`)]);
  const report = response.data;
  const root = document.querySelector("#content");
  root.innerHTML = `<h1 class="text-2xl font-semibold">${esc(report.title)}</h1><p class="mt-2 text-sm text-slate-500">${type === "financial" ? "Approved-expense accounting with separate currency totals." : "Period activities and observations, plus clearly labelled current status snapshots."}</p>
    <form data-report-filters class="card my-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      ${field("period", "Report period", "select", values.period, { items: [["DAILY", "Daily"], ["WEEKLY", "Weekly (Monday-Sunday)"], ["MONTHLY", "Monthly"]] })}
      ${field("date", "Date within the report period", "date", values.date, { required: true })}
      ${field("farmId", "Farm", "select", values.farmId || "", { items: [["", "All farms and general workspace"], ...farms.map(farm => [farm.id, farm.name])] })}
      ${type === "financial" ? field("currency", "Currency (blank = separate currency totals)", "text", values.currency || "", { maxlength: 3 }) : ""}
      <div class="flex flex-wrap items-end gap-2"><button class="btn-primary">Generate report</button><button data-report-reset type="button" class="btn-secondary">Reset</button></div>
    </form>
    <section class="card min-w-0"><h2 class="text-lg font-semibold">${esc(report.startDate)} to ${esc(report.throughDate)}</h2><p class="mt-2 break-words text-sm">${esc(report.organization)} - ${esc(report.farm)}</p><p class="mt-2 text-xs text-slate-500">Africa/Nairobi - Generated ${esc(new Date(report.generatedAt).toLocaleString())}. Downloads use the displayed filters and freshly read records; generate again after changes.</p>
    <div class="mt-4 flex flex-wrap gap-2"><button data-export="pdf" class="btn-primary">Download PDF</button><button data-export="xlsx" class="btn-secondary">Download Excel</button></div>
    <ul class="mt-4 space-y-2 text-xs text-slate-500">${report.notes.map(note => `<li class="break-words">${esc(note)}</li>`).join("")}</ul></section>
    <div class="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">${Object.entries(report.metrics).map(([name, value]) => `<div class="card min-w-0 p-3"><p class="break-words text-xs text-slate-500">${esc(name.replace(/([A-Z])/g, " $1"))}</p><p class="mt-2 text-xl font-semibold">${value}</p></div>`).join("")}</div>
    <div class="mt-5 space-y-4">${report.sections.map((section, i) => `<details class="card min-w-0" ${i === 0 ? "open" : ""}><summary class="cursor-pointer break-words font-semibold text-forest-700">${esc(section.title)} (${section.rows.length})</summary><div data-section="${i}" class="mt-4 space-y-3">${sectionCards(section, 0)}</div>${section.rows.length > 25 ? `<div class="mt-4 flex flex-wrap items-center gap-3"><button data-prev="${i}" class="btn-secondary" disabled>Previous</button><span data-page="${i}" class="text-xs">1-25 of ${section.rows.length}</span><button data-next="${i}" class="btn-secondary">Next</button></div>` : ""}</details>`).join("")}</div>`;
  const form = root.querySelector("[data-report-filters]");
  form.elements.date.min = "2000-01-01"; form.elements.date.max = "2100-12-31";
  form.onsubmit = async event => {
    event.preventDefault();
    const old = filters[type];
    filters[type] = Object.fromEntries(new FormData(form));
    const button = form.querySelector("button");
    button.disabled = true;
    try { await renderReporting(type); }
    catch (error) { filters[type] = old; context.showToast(error.message, "error"); button.disabled = false; }
  };
  root.querySelector("[data-report-reset]").onclick = async () => {
    const old = filters[type]; delete filters[type];
    try { await renderReporting(type); }
    catch (error) { filters[type] = old; context.showToast(error.message, "error"); }
  };
  const positions = report.sections.map(() => 0);
  for (const direction of ["prev", "next"]) root.querySelectorAll(`[data-${direction}]`).forEach(button => button.onclick = () => {
    const i = Number(button.dataset[direction]), section = report.sections[i];
    positions[i] += direction === "next" ? 25 : -25;
    root.querySelector(`[data-section="${i}"]`).innerHTML = sectionCards(section, positions[i]);
    root.querySelector(`[data-page="${i}"]`).textContent = `${positions[i] + 1}-${Math.min(positions[i] + 25, section.rows.length)} of ${section.rows.length}`;
    root.querySelector(`[data-prev="${i}"]`).disabled = positions[i] === 0;
    root.querySelector(`[data-next="${i}"]`).disabled = positions[i] + 25 >= section.rows.length;
  });
  root.querySelectorAll("[data-export]").forEach(button => button.onclick = async () => {
    button.disabled = true;
    try {
      const format = button.dataset.export;
      const blob = await api.download(`/reporting/${type}/${format}?${queryString(values)}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `FOMS-${type}-${report.period.toLowerCase()}-${report.startDate}.${format}`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      context.showToast(`${format === "pdf" ? "PDF" : "Excel"} report downloaded`);
    } catch (error) { context.showToast(error.message, "error"); }
    finally { button.disabled = false; }
  });
}
