import { api } from "./api.js?v=0.13.0";
import { field, modal } from "./v03.js?v=0.13.0";

let context;
let filters = {};
let filterIdentity;
export function configureReports(value) { context = value; }
const esc = (value) => context.escapeHtml(value);
const staff = () => context.getUser().role !== "WORKER";
const categories = [["OBSERVATION", "Field observation"], ["ACTIVITY", "Work performed"], ["PEST_DISEASE", "Pest / disease incident"], ["WEATHER", "Weather observation"], ["RECOMMENDATION", "Recommendation"]];
const severityItems = [["LOW", "Low"], ["MEDIUM", "Medium"], ["HIGH", "High"]];
const statusItems = [["OPEN", "Open"], ["RESOLVED", "Resolved"]];
const dateTime = (value) => new Date(value).toLocaleString();
export function localDateTime(value = new Date()) {
  return observationTime(value).slice(0, 16);
}
function observationTime(value = new Date()) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
}
function cropLabel(crop) {
  return `${crop.cropName}${crop.variety ? ` - ${crop.variety}` : ""}${crop.block ? ` (${crop.block.name})` : ""}`;
}
function livestockLabel(record) { return `${record.species.toLowerCase()} - ${record.identifier || record.id.slice(0, 8)}`; }
function subjectMarkup(report) {
  const subject = report.crop ? cropLabel(report.crop) : report.livestock ? livestockLabel(report.livestock) : "General observation";
  const target = report.crop ? `crops/${report.crop.id}` : report.livestock ? `livestock/${report.livestock.id}` : null;
  const accessible = staff() && (!report.livestock || context.getUser().role !== "AGRONOMIST");
  return `${esc(report.farm?.name || "Workspace")} &middot; ${target && accessible ? `<a class="underline" href="#${target}">${esc(subject)}</a>` : esc(subject)}`;
}
function incidentMarkup(report) {
  return report.incidentStatus ? `<p class="mt-2 break-words text-sm font-semibold ${report.incidentStatus === "OPEN" ? "text-amber-700" : "text-forest-700"}">Incident: ${report.incidentStatus === "OPEN" ? "Open" : "Resolved"} &middot; ${report.incidentSeverity ? `${esc(report.incidentSeverity.toLowerCase())} severity` : "Severity not yet assessed"}</p>` : "";
}
function photoMarkup(report) {
  return report.photoPath ? `<a class="mt-4 block" href="${esc(report.photoPath)}" target="_blank" rel="noopener"><img src="${esc(report.photoPath)}" alt="Photo accompanying ${esc(report.title)}" loading="lazy" class="max-h-72 w-full rounded-xl object-contain"></a>` : "";
}

export async function openDailyReport(report = null) {
  try {
    const { data: selectors } = await api.get("/journal/selectors");
    if (report?.farm && !selectors.farms.some((item) => item.id === report.farm.id)) selectors.farms.push(report.farm);
    if (report?.crop && !selectors.crops.some((item) => item.id === report.crop.id)) selectors.crops.push({ ...report.crop, farmId: report.farmId });
    if (report?.livestock && !selectors.livestock.some((item) => item.id === report.livestock.id)) selectors.livestock.push({ ...report.livestock, farmId: report.farmId });
    let selectedPhoto;
    const locked = Boolean(report?._count.followUps);
    const form = modal(report ? "Edit daily report" : "Daily farm report",
      field("subjectType", "What are you reporting on?", "select", report?.subjectType || "GENERAL", { items: [["GENERAL", "General farm observation"], ["CROP", "Crop"], ["LIVESTOCK", "Livestock"]] }) +
      field("farmId", "Farm", "select", report?.farmId || "", { items: [["", "General workspace observation"], ...selectors.farms.map((farm) => [farm.id, farm.name])] }) +
      '<div data-crop hidden>' + field("cropId", "Associated crop", "select", "", { items: [["", "Select a crop"]] }) + '</div>' +
      '<div data-livestock hidden>' + field("livestockId", "Associated livestock", "select", "", { items: [["", "Select livestock"]] }) + '</div>' +
      field("category", "Report type", "select", report?.category || "OBSERVATION", { items: [...categories, ...(report && !categories.some(([key]) => key === report.category) ? [[report.category, report.category]] : [])] }) +
      field("title", "Short report title", "text", report?.title || "", { required: true, maxlength: 160 }) +
      field("body", "What did you observe or do?", "textarea", report?.body || "", { required: true }) +
      field("observedAt", "Observation date and time", "datetime-local", observationTime(report?.observedAt || new Date()), { required: true }) +
      (staff() ? '<details data-details><summary class="cursor-pointer text-sm font-semibold text-forest-700">Additional journal details</summary><div class="mt-3 space-y-4">' +
        field("weather", "Weather", "text", report?.weather || "") + field("incident", "Pest or disease details", "textarea", report?.incident || "") +
        '<div data-severity hidden>' + field("incidentSeverity", "Incident severity", "select", report?.incidentSeverity || "MEDIUM", { items: severityItems }) + '</div>' +
        field("cost", "Recorded cost (KES)", "number", report?.cost || 0) + '</div></details>' : "") +
      (report ? `${locked ? '<p class="text-xs text-slate-500">Original subject/time are retained after follow-ups. Update severity through an incident follow-up.</p>' : ""}${report.photoPath ? '<p class="text-sm text-slate-500">The existing private photo will be retained.</p>' : ""}` :
        '<section class="rounded-xl border border-forest-200 p-4"><span class="label">Accompanying photo (optional, JPEG / PNG / WebP, up to 10 MB)</span><div class="flex flex-wrap gap-2"><button type="button" data-camera class="btn-primary">Take photo</button><button type="button" data-upload class="btn-secondary">Upload photo</button><button type="button" data-clear-photo class="btn-secondary" hidden>Remove photo</button></div><input data-photo-input type="file" accept="image/jpeg,image/png,image/webp" hidden><input data-camera-input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden><p data-photo-name class="mt-2 break-words text-xs text-slate-500">No photo selected</p></section>'),
      async (_payload, form) => {
        const data = new FormData(form);
        if (!form.elements.observedAt.disabled) data.set("observedAt", new Date(form.elements.observedAt.value).toISOString());
        if (report) {
          const payload = Object.fromEntries(data);
          for (const key of ["farmId", "cropId", "livestockId"]) if (Object.hasOwn(payload, key) && !payload[key]) payload[key] = null;
          if (Object.hasOwn(payload, "farmId") && report.farmId !== payload.farmId) payload.blockId = null;
          return api.patch(`/journal/${report.id}`, payload);
        }
        if (selectedPhoto) data.set("photo", selectedPhoto);
        return api.upload("/journal", data);
      });
    form.elements.observedAt.max = observationTime();
    form.elements.body.maxLength = 10000;
    if (locked) for (const key of ["subjectType", "farmId", "cropId", "livestockId", "observedAt"]) form.elements[key].disabled = true;
    function updateSubjects(initial = false) {
      const type = form.elements.subjectType.value;
      const farmId = form.elements.farmId.value;
      form.elements.farmId.required = type !== "GENERAL";
      form.querySelector("[data-crop]").hidden = type !== "CROP";
      form.querySelector("[data-livestock]").hidden = type !== "LIVESTOCK";
      form.elements.cropId.required = type === "CROP";
      form.elements.livestockId.required = type === "LIVESTOCK";
      form.elements.cropId.innerHTML = '<option value="">Select a crop</option>' + (type === "CROP" ? selectors.crops.filter((crop) => crop.farmId === farmId).map((crop) => `<option value="${crop.id}">${esc(cropLabel(crop))}</option>`).join("") : "");
      form.elements.livestockId.innerHTML = '<option value="">Select livestock</option>' + (type === "LIVESTOCK" ? selectors.livestock.filter((item) => item.farmId === farmId).map((item) => `<option value="${item.id}">${esc(livestockLabel(item))}</option>`).join("") : "");
      if (initial && report) {
        form.elements.cropId.value = report.cropId || "";
        form.elements.livestockId.value = report.livestockId || "";
      }
    }
    function updateDetails() {
      const incident = form.elements.category.value === "PEST_DISEASE" || Boolean(form.elements.incident?.value.trim());
      if (staff()) {
        form.querySelector("[data-severity]").hidden = !incident;
        form.elements.incidentSeverity.disabled = !incident || locked;
        if (["PEST_DISEASE", "WEATHER", "RECOMMENDATION"].includes(form.elements.category.value)) form.querySelector("[data-details]").open = true;
      }
    }
    form.elements.subjectType.onchange = () => updateSubjects();
    form.elements.farmId.onchange = () => updateSubjects();
    form.elements.category.onchange = updateDetails;
    if (staff()) form.elements.incident.oninput = updateDetails;
    updateSubjects(true);
    updateDetails();
    if (!report) {
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
    }
  } catch (error) { context.showToast(error.message, "error"); }
}

function openFollowUp(report) {
  const requestId = crypto.randomUUID();
  const form = modal("Incident follow-up",
    field("notes", "What was checked or done?", "textarea", "", { required: true }) +
    field("observedAt", "Follow-up date and time", "datetime-local", observationTime(), { required: true }) +
    field("incidentStatus", "Incident status after this observation", "select", report.incidentStatus, { items: statusItems }) +
    field("incidentSeverity", "Assessed severity", "select", report.incidentSeverity || "MEDIUM", { items: severityItems }) +
    '<p class="text-xs text-slate-500">Notes are retained permanently. A backdated observation does not overwrite a newer incident status or severity.</p>',
    (payload) => api.post(`/journal/${report.id}/follow-ups`, { ...payload, observedAt: new Date(payload.observedAt).toISOString(), requestId }));
  form.elements.notes.maxLength = 4000;
  form.elements.observedAt.min = observationTime(report.observedAt);
  form.elements.observedAt.max = observationTime();
}

function attachArchive(root) {
  root.querySelectorAll("[data-archive-report]").forEach((button) => { button.onclick = async () => {
    if (!confirm("Archive this daily report? Its history will be preserved.")) return;
    button.disabled = true;
    try {
      context.showToast((await api.delete(`/journal/${button.dataset.archiveReport}`)).message);
      if (location.hash.includes("/")) location.hash = "#journal";
      else await renderReports();
    } catch (error) { button.disabled = false; context.showToast(error.message, "error"); }
  }; });
}

export async function renderReports(id) {
  const root = document.querySelector("#content");
  if (id) {
    const { data: report } = await api.get(`/journal/${id}`);
    root.innerHTML = `<div class="mb-5"><a class="text-sm font-semibold text-forest-700" href="#journal">Back to daily reports</a></div>
      <article class="card min-w-0 break-words">
        <h1 class="text-2xl font-semibold">${esc(report.title)}</h1>
        <p class="mt-2 text-sm text-slate-500">${esc(dateTime(report.observedAt))} &middot; ${esc(report.author?.name || "Former user")}</p>
        <p class="mt-2 text-sm font-medium">${subjectMarkup(report)}</p>
        <p class="mt-2 text-xs text-slate-500">${esc(categories.find(([key]) => key === report.category)?.[1] || report.category)}</p>
        ${incidentMarkup(report)}
        <p class="mt-4 whitespace-pre-wrap text-sm">${esc(report.body)}</p>
        ${report.weather ? `<p class="mt-3 whitespace-pre-wrap text-sm">Weather: ${esc(report.weather)}</p>` : ""}
        ${report.incident ? `<p class="mt-3 whitespace-pre-wrap text-sm">Incident details: ${esc(report.incident)}</p>` : ""}
        ${report.cost ? `<p class="mt-3 text-sm">Recorded cost: KES ${Number(report.cost).toLocaleString()}</p>` : ""}
        ${photoMarkup(report)}
        <div class="mt-5 flex flex-wrap gap-2"><button id="edit-report" class="btn-secondary">Edit report</button><button data-archive-report="${report.id}" class="btn-secondary">Archive</button>${staff() && report.incidentStatus ? '<button id="follow-up-report" class="btn-primary">Add incident follow-up</button>' : ""}</div>
      </article>
      ${report.incidentStatus ? `<section class="mt-5 space-y-3"><h2 class="text-lg font-semibold">Incident follow-up history</h2>${report.followUps.map((item) => `<article class="card min-w-0 break-words"><p class="text-xs text-slate-500">${esc(dateTime(item.observedAt))} &middot; ${esc(item.author?.name || "Former user")}</p><p class="mt-2 text-sm font-semibold">${esc(item.incidentStatus.toLowerCase())} &middot; ${esc(item.incidentSeverity?.toLowerCase() || "not assessed")}</p><p class="mt-2 whitespace-pre-wrap text-sm">${esc(item.notes)}</p></article>`).join("") || '<p class="text-sm text-slate-500">No follow-ups recorded yet.</p>'}</section>` : ""}`;
    root.querySelector("#edit-report").onclick = () => openDailyReport(report);
    if (root.querySelector("#follow-up-report")) root.querySelector("#follow-up-report").onclick = () => openFollowUp(report);
    attachArchive(root);
    return;
  }
  const identity = `${context.getUser().organization.id}:${context.getUser().id}`;
  if (filterIdentity !== identity) { filters = {}; filterIdentity = identity; }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) {
    if (key === "from" || key === "to") query.set(key, new Date(`${value}T${key === "from" ? "00:00:00.000" : "23:59:59.999"}`).toISOString());
    else query.set(key, value);
  }
  const [reports, { data: selectors }] = await Promise.all([context.loadAll(`/journal?${query}`), api.get("/journal/selectors")]);
  root.innerHTML = `<div class="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 class="text-2xl font-semibold">Daily reports / farm journal</h1><p class="mt-2 text-sm text-slate-500">${staff() ? "Operational logs, field observations, weather and incident follow-ups." : "Your crop, livestock and general farm reports."}</p></div><button id="new-daily-report" class="btn-primary">Add daily report</button></div>
    <form id="journal-filters" class="card mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      ${field("search", "Search reports", "search", filters.search || "", { maxlength: 200 })}
      ${field("farmId", "Farm", "select", filters.farmId || "", { items: [["", "All farms"], ...selectors.farms.map((farm) => [farm.id, farm.name])] })}
      ${field("subjectType", "Subject", "select", filters.subjectType || "", { items: [["", "All subjects"], ["GENERAL", "General farm"], ["CROP", "Crop"], ["LIVESTOCK", "Livestock"]] })}
      ${field("category", "Report type", "select", filters.category || "", { items: [["", "All report types"], ...categories] })}
      ${field("incidentStatus", "Incident status", "select", filters.incidentStatus || "", { items: [["", "All incidents / reports"], ...statusItems] })}
      ${field("from", "From date", "date", filters.from || "")}${field("to", "To date", "date", filters.to || "")}
      <div class="flex flex-wrap items-end gap-2"><button type="submit" class="btn-primary">Apply filters</button><button type="button" id="clear-journal-filters" class="btn-secondary">Clear</button></div>
      <p data-filter-error role="alert" class="text-sm text-red-700"></p>
    </form><p class="mb-3 text-sm text-slate-500">${reports.length} matching reports</p>
    <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">${reports.map((report) => `<article class="card min-w-0 break-words"><h2 class="font-semibold"><a class="text-forest-700" href="#journal/${report.id}">${esc(report.title)}</a></h2><p class="mt-1 text-xs text-slate-500">${esc(dateTime(report.observedAt))} &middot; ${esc(report.author?.name || "Former user")}</p><p class="mt-2 text-sm font-medium">${subjectMarkup(report)}</p><p class="mt-2 text-xs text-slate-500">${esc(categories.find(([key]) => key === report.category)?.[1] || report.category)}</p>${incidentMarkup(report)}<p class="mt-3 line-clamp-3 whitespace-pre-wrap text-sm text-slate-600">${esc(report.body)}</p>${photoMarkup(report)}<div class="mt-4 flex flex-wrap gap-2"><a class="btn-secondary" href="#journal/${report.id}">View report${report._count.followUps ? ` / ${report._count.followUps} follow-ups` : ""}</a><button class="btn-secondary" data-archive-report="${report.id}">Archive</button></div></article>`).join("") || '<div class="card text-sm text-slate-500">No reports match these filters.</div>'}</div>`;
  root.querySelector("#new-daily-report").onclick = () => openDailyReport();
  root.querySelector("#journal-filters").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const next = Object.fromEntries(new FormData(form));
    if (next.from && next.to && next.from > next.to) { form.querySelector("[data-filter-error]").textContent = "Start date must not be after end date."; return; }
    const previous = filters;
    filters = next;
    try { await renderReports(); } catch (error) { filters = previous; form.querySelector("[data-filter-error]").textContent = error.message; }
  };
  root.querySelector("#clear-journal-filters").onclick = async () => {
    filters = {};
    try { await renderReports(); } catch (error) { context.showToast(error.message, "error"); }
  };
  attachArchive(root);
}
