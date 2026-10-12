import { api } from "./api.js?v=0.5.0";
import { field, modal } from "./v03.js?v=0.5.0";

let context;
export function configureReports(value) { context = value; }
const esc = (value) => context.escapeHtml(value);
export function localDateTime(value = new Date()) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function cropLabel(crop) {
  return `${crop.cropName}${crop.variety ? ` - ${crop.variety}` : ""}${crop.block ? ` (${crop.block.name})` : ""}`;
}
function livestockLabel(record) { return `${record.species.toLowerCase()} - ${record.identifier || record.id.slice(0, 8)}`; }

export async function openDailyReport() {
  try {
    const { data: selectors } = await api.get("/journal/selectors");
    let selectedPhoto;
    const form = modal("Daily farm report",
      field("subjectType", "What are you reporting on?", "select", "GENERAL", { items: [["GENERAL", "General farm observation"], ["CROP", "Crop"], ["LIVESTOCK", "Livestock"]] }) +
      field("farmId", "Farm", "select", "", { items: [["", "General workspace observation"], ...selectors.farms.map((farm) => [farm.id, farm.name])] }) +
      '<div data-crop hidden>' + field("cropId", "Associated crop", "select", "", { items: [["", "Select a crop"]] }) + '</div>' +
      '<div data-livestock hidden>' + field("livestockId", "Associated livestock", "select", "", { items: [["", "Select livestock"]] }) + '</div>' +
      field("title", "Short report title", "text", "", { required: true, maxlength: 160 }) +
      field("body", "What did you observe or do?", "textarea", "", { required: true }) +
      field("observedAt", "Observation date and time", "datetime-local", localDateTime(), { required: true }) +
      (context.getUser().role !== "WORKER" ? '<details><summary class="cursor-pointer text-sm font-semibold text-forest-700">Additional journal details</summary><div class="mt-3 space-y-4">' +
        field("category", "Category", "select", "OBSERVATION", { items: ["OBSERVATION", "ACTIVITY", "PEST_DISEASE", "WEATHER", "RECOMMENDATION"].map((item) => [item, item.toLowerCase().replaceAll("_", " ")]) }) +
        field("weather", "Weather", "text") + field("incident", "Pest or disease incident", "textarea") + field("cost", "Cost (KES)", "number", 0) + '</div></details>' : "") +
      '<section class="rounded-xl border border-forest-200 p-4"><span class="label">Accompanying photo (optional, JPEG / PNG / WebP, up to 10 MB)</span><div class="flex flex-wrap gap-2"><button type="button" data-camera class="btn-primary">Take photo</button><button type="button" data-upload class="btn-secondary">Upload photo</button><button type="button" data-clear-photo class="btn-secondary" hidden>Remove photo</button></div><input data-photo-input type="file" accept="image/jpeg,image/png,image/webp" hidden><input data-camera-input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden><p data-photo-name class="mt-2 break-words text-xs text-slate-500">No photo selected</p></section>',
      async (_payload, form) => {
        const data = new FormData(form);
        data.set("observedAt", new Date(form.elements.observedAt.value).toISOString());
        if (selectedPhoto) data.set("photo", selectedPhoto);
        return api.upload("/journal", data);
      });
    form.elements.observedAt.max = localDateTime();
    function updateSubjects() {
      const type = form.elements.subjectType.value;
      const farmId = form.elements.farmId.value;
      form.elements.farmId.required = type !== "GENERAL";
      form.querySelector("[data-crop]").hidden = type !== "CROP";
      form.querySelector("[data-livestock]").hidden = type !== "LIVESTOCK";
      form.elements.cropId.required = type === "CROP";
      form.elements.livestockId.required = type === "LIVESTOCK";
      form.elements.cropId.innerHTML = '<option value="">Select a crop</option>' + (type === "CROP" ? selectors.crops.filter((crop) => crop.farmId === farmId).map((crop) => `<option value="${crop.id}">${esc(cropLabel(crop))}</option>`).join("") : "");
      form.elements.livestockId.innerHTML = '<option value="">Select livestock</option>' + (type === "LIVESTOCK" ? selectors.livestock.filter((item) => item.farmId === farmId).map((item) => `<option value="${item.id}">${esc(livestockLabel(item))}</option>`).join("") : "");
    }
    form.elements.subjectType.onchange = updateSubjects;
    form.elements.farmId.onchange = updateSubjects;
    form.querySelector("[data-camera]").onclick = () => form.querySelector("[data-camera-input]").click();
    form.querySelector("[data-upload]").onclick = () => form.querySelector("[data-photo-input]").click();
    for (const input of form.querySelectorAll("input[type=file]")) input.onchange = () => {
      if (!input.files[0]) return;
      const file = input.files[0];
      if (file.size > 10 * 1024 * 1024) {
        form.querySelector("[data-error]").textContent = "Photo is too large. Choose a photo smaller than 10 MB.";
        input.value = "";
        return;
      }
      selectedPhoto = file;
      form.querySelector("[data-photo-name]").textContent = file.name;
      form.querySelector("[data-clear-photo]").hidden = false;
      form.querySelector("[data-error]").textContent = "";
    };
    form.querySelector("[data-clear-photo]").onclick = () => {
      selectedPhoto = null;
      form.querySelectorAll("input[type=file]").forEach((input) => { input.value = ""; });
      form.querySelector("[data-photo-name]").textContent = "No photo selected";
      form.querySelector("[data-clear-photo]").hidden = true;
    };
  } catch (error) { context.showToast(error.message, "error"); }
}

export async function renderReports() {
  const reports = await context.loadAll("/journal");
  const worker = context.getUser().role === "WORKER";
  const root = document.querySelector("#content");
  root.innerHTML = `<div class="mb-6 flex flex-wrap items-end justify-between gap-3"><div><h1 class="text-2xl font-semibold">Daily reports / farm journal</h1><p class="mt-2 text-sm text-slate-500">${worker ? "Your crop, livestock and general farm observations." : "Workspace observations, with specific crops, livestock and accompanying photos."}</p></div><button id="new-daily-report" class="btn-primary">Add daily report</button></div><div class="grid gap-4 xl:grid-cols-2">${reports.map((report) => {
    const subject = report.crop ? cropLabel(report.crop) : report.livestock ? livestockLabel(report.livestock) : "General observation";
    return `<article class="card min-w-0"><div class="flex flex-wrap items-start justify-between gap-2"><div class="min-w-0 flex-1"><h2 class="break-words font-semibold">${esc(report.title)}</h2><p class="mt-1 text-xs text-slate-500">${esc(new Date(report.observedAt).toLocaleString())} · ${esc(report.author?.name || "Former user")}</p></div><button class="btn-secondary" data-archive-report="${report.id}">Archive</button></div><p class="mt-3 break-words text-sm font-medium">${esc(report.farm?.name || "Workspace")} · ${!worker && report.crop ? `<a class="underline" href="#crops/${report.crop.id}">${esc(subject)}</a>` : esc(subject)}</p><p class="mt-3 whitespace-pre-wrap break-words text-sm text-slate-600">${esc(report.body)}</p>${report.weather ? `<p class="mt-2 text-xs">Weather: ${esc(report.weather)}</p>` : ""}${report.incident ? `<p class="mt-2 text-sm">Incident: ${esc(report.incident)}</p>` : ""}${report.cost ? `<p class="mt-2 text-xs">Recorded cost: KES ${Number(report.cost).toLocaleString()}</p>` : ""}${report.photoPath ? `<a class="mt-4 block" href="${esc(report.photoPath)}" target="_blank" rel="noopener"><img src="${esc(report.photoPath)}" alt="Photo accompanying ${esc(report.title)}" loading="lazy" class="max-h-72 w-full rounded-xl object-contain"></a>` : ""}</article>`;
  }).join("") || '<div class="card text-sm text-slate-500">No daily reports yet. Record your first observation.</div>'}</div>`;
  root.querySelector("#new-daily-report").onclick = openDailyReport;
  root.querySelectorAll("[data-archive-report]").forEach((button) => { button.onclick = async () => {
    if (!confirm("Archive this daily report? Its history will be preserved.")) return;
    try { context.showToast((await api.delete(`/journal/${button.dataset.archiveReport}`)).message); await renderReports(); }
    catch (error) { context.showToast(error.message, "error"); }
  }; });
}
