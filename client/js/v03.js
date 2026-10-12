import { api } from "./api.js?v=0.4.0";
import { suggestCropSchedule } from "./crop-schedule.js?v=0.4.0";

let context;
export function configureV03(value) { context = value; }
const esc = (value) => context.escapeHtml(value);
const user = () => context.getUser();
const content = () => document.querySelector("#content");
const canManageCrops = () => ["OWNER", "MANAGER", "AGRONOMIST"].includes(user().role);
const stages = ["PLANNED", "NURSERY", "TRANSPLANTED", "GROWING", "FLOWERING", "FRUITING", "READY_TO_HARVEST", "HARVESTED", "CANCELLED"];
const label = (value) => value.toLowerCase().replaceAll("_", " ");
const date = (value) => value ? new Date(value).toLocaleDateString() : "Not set";
const day = (value) => value ? new Date(value).toISOString().slice(0, 10) : "";
const passwordHelp = "At least 8 characters, including a letter, number and special character.";

export function field(name, title, type = "text", value = "", options = {}) {
  const required = options.required ? "required" : "";
  const common = `class="field" name="${name}" ${required}`;
  const control = type === "select"
    ? `<select ${common}>${options.items.map(([id, text]) => `<option value="${esc(id)}" ${String(value) === String(id) ? "selected" : ""}>${esc(text)}</option>`).join("")}</select>`
    : type === "textarea" ? `<textarea ${common} rows="3">${esc(value)}</textarea>`
    : `<input ${common} type="${type}" value="${esc(value)}" ${type === "password" ? 'autocomplete="new-password" minlength="8" maxlength="72"' : type === "number" ? 'step="any" min="0"' : type === "datetime-local" ? 'step="0.001"' : ""} ${options.maxlength ? `maxlength="${options.maxlength}"` : ""}>`;
  return `<label class="block"><span class="label">${esc(title)}</span>${control}</label>`;
}

export function modal(title, markup, onSubmit) {
  const root = document.querySelector("#modal-root");
  root.innerHTML = `<div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-5"><section role="dialog" aria-modal="true" aria-labelledby="modal-title" class="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-2xl sm:p-7"><h2 id="modal-title" class="text-xl font-semibold">${esc(title)}</h2><form class="mt-5 space-y-4">${markup}<p data-error role="alert" class="text-sm text-red-700"></p><div class="flex gap-3"><button data-close type="button" class="btn-secondary flex-1">Cancel</button><button type="submit" class="btn-primary flex-1">Save</button></div></form></section></div>`;
  root.querySelector("[data-close]").onclick = () => { root.innerHTML = ""; };
  root.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    try {
      const response = await onSubmit(Object.fromEntries(new FormData(form)), form);
      root.innerHTML = "";
      context.showToast(response.message);
      if (context.getUser()) await context.reload();
    } catch (error) { button.disabled = false; form.querySelector("[data-error]").textContent = error.message; }
  };
  root.querySelector("input, select, textarea")?.focus();
  return root.querySelector("form");
}

function accountFields(profile = {}, includePassword = true) {
  return field("name", "Full name", "text", profile.name, { required: true, maxlength: 100 })
    + field("username", "Username (unique across FOMS)", "text", profile.username, { required: true, maxlength: 80 })
    + field("email", "Contact email (not used to sign in)", "email", profile.email, { required: true })
    + (includePassword ? field("password", "Initial password", "password", "", { required: true }) + `<p class="text-xs text-slate-500">${passwordHelp} Share it securely; users can change it in Account.</p>` : "");
}

export async function renderClients() {
  const { data } = await api.get("/admin/clients");
  content().innerHTML = `<div class="mb-6 flex flex-wrap justify-between gap-3"><div><h1 class="text-2xl font-semibold">Client workspaces</h1><p class="mt-2 text-sm text-slate-500">Only FOMS Admin can onboard clients. Owners then create farms and add their team.</p></div><button id="new-client" class="btn-primary">Add client</button></div><div class="space-y-4">${data.map((client) => `<article class="card"><h2 class="font-semibold">${esc(client.name)}</h2><p class="mt-2 text-sm">${client._count.farms} farms · ${client._count.memberships} users</p>${client.memberships.map(({ user: owner }) => `<div class="mt-3"><p class="break-words text-sm text-slate-500">${esc(owner.name)} · Username: <strong>${esc(owner.username)}</strong> · ${esc(owner.email)}</p><div class="mt-2 flex flex-wrap gap-2"><button class="btn-secondary" data-client="${client.id}" data-owner="${owner.id}" data-edit-client>Edit client / owner</button><button class="btn-secondary" data-client="${client.id}" data-owner="${owner.id}" data-reset-client>Reset password</button></div></div>`).join("")}</article>`).join("") || '<div class="card">No clients yet. Add your first client workspace.</div>'}</div>`;
  document.querySelector("#new-client").onclick = () => modal("Create client account", field("organizationName", "Client workspace name", "text", "", { required: true, maxlength: 120 }) + accountFields(), (payload) => api.post("/admin/clients", payload));
  content().querySelectorAll("[data-edit-client]").forEach((button) => { button.onclick = () => {
    const client = data.find((item) => item.id === button.dataset.client);
    const owner = client.memberships.find((item) => item.user.id === button.dataset.owner).user;
    modal("Edit client / owner", field("organizationName", "Client workspace name", "text", client.name, { required: true, maxlength: 120 }) + accountFields(owner, false),
      (payload) => api.patch(`/admin/clients/${client.id}`, { ...payload, ownerId: owner.id }));
  }; });
  content().querySelectorAll("[data-reset-client]").forEach((button) => { button.onclick = async () => {
    if (!confirm("Invalidate this owner's existing sessions and generate a one-time sign-in password?")) return;
    button.disabled = true;
    try {
      const response = await api.post(`/admin/clients/${button.dataset.client}/owners/${button.dataset.owner}/reset-password`, {});
      const root = document.querySelector("#modal-root");
      root.innerHTML = `<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><section role="dialog" aria-modal="true" aria-labelledby="otp-title" class="card w-full max-w-lg"><h2 id="otp-title" class="text-xl font-semibold">One-time sign-in password</h2><p class="mt-3 text-sm">Share securely. This password is shown only once, expires ${esc(new Date(response.data.expiresAt).toLocaleString())}, and must be changed immediately after signing in.</p><label class="mt-4 block"><span class="label">Temporary password / OTP</span><input class="field font-mono" readonly value="${esc(response.data.temporaryPassword)}"></label><button data-dismiss-otp class="btn-primary mt-4">Done</button></section></div>`;
      root.querySelector("[data-dismiss-otp]").onclick = () => { root.innerHTML = ""; };
    } catch (error) { context.showToast(error.message, "error"); }
    finally { button.disabled = false; }
  }; });
}

export async function renderTeam() {
  const { data } = await api.get("/team");
  const manage = ["OWNER", "MANAGER"].includes(user().role);
  content().innerHTML = `<div class="mb-6 flex flex-wrap justify-between gap-3"><div><h1 class="text-2xl font-semibold">Workspace users</h1><p class="mt-2 text-sm text-slate-500">Access covers all farms in this client workspace.</p></div>${manage ? '<button id="new-member" class="btn-primary">Add user</button>' : ""}</div><div class="space-y-3">${data.map((member) => {
    const allowed = manage && (user().role === "OWNER" || member.role !== "OWNER");
    return `<article class="card flex flex-wrap items-center gap-3"><div class="min-w-0 flex-1"><h2 class="font-semibold">${esc(member.user.name)}</h2><p class="break-all text-sm text-slate-500">Username: ${esc(member.user.username)} · ${esc(member.user.email)}</p></div><span class="text-xs font-semibold">${esc(label(member.role))}</span>${allowed ? `<button data-edit="${member.id}" class="btn-secondary">Edit</button>${member.user.id !== user().user.id ? `<button data-remove="${member.id}" class="btn-secondary">Remove</button>` : ""}` : ""}</article>`;
  }).join("")}</div><p class="mt-4 text-xs text-slate-500">Removing access preserves farm records and unassigns this user's tasks. Managers cannot create, edit or remove owners.</p>`;
  function openMember(member) {
    const items = ["MANAGER", "AGRONOMIST", "WORKER", ...(user().role === "OWNER" ? ["OWNER"] : [])].map((role) => [role, label(role)]);
    modal(member ? "Edit user" : "Add user", accountFields(member?.user, !member) + field("role", "Workspace role", "select", member?.role || "WORKER", { items }), async (payload) => {
      const response = member ? await api.patch(`/team/${member.id}`, payload) : await api.post("/team", payload);
      if (member?.user.id === user().user.id) context.signedOut();
      return response;
    });
  }
  document.querySelector("#new-member")?.addEventListener("click", () => openMember());
  content().querySelectorAll("[data-edit]").forEach((button) => { button.onclick = () => openMember(data.find((member) => member.id === button.dataset.edit)); });
  content().querySelectorAll("[data-remove]").forEach((button) => { button.onclick = async () => {
    if (!confirm("Remove this user's workspace access? Their records will remain.")) return;
    try { context.showToast((await api.delete(`/team/${button.dataset.remove}`)).message); await renderTeam(); }
    catch (error) { context.showToast(error.message, "error"); }
  }; });
}

export function renderAccount() {
  content().innerHTML = `<section class="card max-w-xl"><h1 class="text-2xl font-semibold">${user().passwordChangeRequired ? "Set your new password" : "Your account"}</h1><p class="mt-2 text-sm text-slate-500">Username: <strong>${esc(user().user.username)}</strong></p>${user().passwordChangeRequired ? '<p class="mt-3 text-sm text-amber-700">Your temporary password has been used. Set a new password now to unlock your workspace. If you leave before finishing, FOMS Admin must issue a new reset.</p>' : ""}<form id="password-form" class="mt-6 space-y-4">${user().passwordChangeRequired ? "" : field("currentPassword", "Current password", "password", "", { required: true })}${field("password", "New password", "password", "", { required: true })}${field("confirmation", "Confirm new password", "password", "", { required: true })}<p class="text-xs text-slate-500">${passwordHelp} Changing your password signs out all your sessions.</p><p data-error role="alert" class="text-sm text-red-700"></p><button class="btn-primary" type="submit">Change password</button></form></section>`;
  const form = document.querySelector("#password-form");
  if (form.elements.currentPassword) {
    form.elements.currentPassword.removeAttribute("minlength");
    form.elements.currentPassword.autocomplete = "current-password";
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    const { confirmation, ...payload } = Object.fromEntries(new FormData(form));
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      if (confirmation !== payload.password) throw new Error("New passwords do not match");
      const response = await api.post("/auth/password", payload);
      context.signedOut();
      context.showToast(response.message);
    } catch (error) { button.disabled = false; form.querySelector("[data-error]").textContent = error.message; }
  };
}

export function renderSetup(token) {
  const root = document.querySelector("#app");
  root.innerHTML = `<main class="flex min-h-screen items-center justify-center p-5"><section class="card w-full max-w-md"><h1 class="text-2xl font-semibold">Set your account password</h1><p class="mt-2 text-sm text-slate-500">This private setup link expires in 24 hours and can be used once.</p><form class="mt-5 space-y-4">${field("password", "New password", "password", "", { required: true })}${field("confirmation", "Confirm new password", "password", "", { required: true })}<p class="text-xs text-slate-500">${passwordHelp}</p><p data-error role="alert" class="text-sm text-red-700"></p><button class="btn-primary w-full" type="submit">Set password</button></form></section></main>`;
  const form = root.querySelector("form");
  form.onsubmit = async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form));
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      if (payload.password !== payload.confirmation) throw new Error("Passwords do not match");
      const response = await api.post("/auth/setup", { token, password: payload.password });
      history.replaceState(null, "", "/");
      context.signedOut();
      context.showToast(`Password set. Sign in as ${response.data.username}.`);
    } catch (error) { button.disabled = false; form.querySelector("[data-error]").textContent = error.message; }
  };
}

export async function renderCrops(id) {
  if (id) return renderCrop(id);
  const [data, farmRecords, { data: types }] = await Promise.all([context.loadAll("/crops"), context.loadAll("/farms"), api.get("/crops/types")]);
  content().innerHTML = `<div class="mb-6 flex flex-wrap justify-between gap-3"><div><h1 class="text-2xl font-semibold">Crop management</h1><p class="mt-2 text-sm text-slate-500">Open a crop to monitor its stage, dates, irrigation, fertilizer and harvests.</p></div>${canManageCrops() ? '<div class="flex gap-2"><button id="new-type" class="btn-secondary">Add crop type</button><button id="new-crop" class="btn-primary">Add crop cycle</button></div>' : ""}</div><div class="grid gap-4 md:grid-cols-2">${data.map((crop) => `<a href="#crops/${crop.id}" class="card block text-slate-800 hover:border-forest-500 focus-visible:ring-2 focus-visible:ring-forest-500"><div class="flex justify-between gap-2"><h2 class="font-semibold">${esc(crop.cropName)} ${esc(crop.variety || "")}</h2><span class="text-xs font-semibold text-forest-700">${esc(label(crop.status))}</span></div><p class="mt-2 text-sm text-slate-500">${esc(farmRecords.find((farm) => farm.id === crop.farmId)?.name || "Farm")} · ${crop.acreage ?? "Area not set"} acres</p><p class="mt-2 text-xs text-slate-500">Planting: ${date(crop.plantingDate)} · Expected harvest: ${date(crop.expectedHarvest)}</p></a>`).join("") || '<p class="card">No crop cycles yet.</p>'}</div><section class="card mt-6"><h2 class="font-semibold">Crop master data</h2><p class="mt-1 text-xs text-slate-500">Defaults are copied into new cycles; changing a type does not alter existing cycles.</p><div class="mt-3 space-y-2">${types.map((type) => `<div class="flex items-center justify-between gap-3"><p class="text-sm">${esc(type.name)} · ${type.requiresNursery ? `Nursery: ${type.nurseryDays} days` : "Direct planting"} · Field maturity: ${type.maturityDays ?? "not set"} days</p>${canManageCrops() ? `<button data-type-edit="${type.id}" class="btn-secondary">Edit</button>` : ""}</div>`).join("") || '<p class="text-sm text-slate-500">No crop types saved.</p>'}</div></section>`;
  document.querySelector("#new-crop")?.addEventListener("click", () => openCropModal());
  document.querySelector("#new-type")?.addEventListener("click", () => openTypeModal());
  content().querySelectorAll("[data-type-edit]").forEach((button) => { button.onclick = () => openTypeModal(types.find((type) => type.id === button.dataset.typeEdit)); });
}

function openTypeModal(type = {}) {
  modal(type.id ? "Edit crop type" : "Add crop type",
    field("name", "Crop name", "text", type.name, { required: true }) +
    field("requiresNursery", "Requires nursery?", "select", String(type.requiresNursery ?? false), { items: [["false", "No - direct planting"], ["true", "Yes - nursery then transplant"]] }) +
    field("nurseryDays", "Default nursery duration (days)", "number", type.nurseryDays) +
    field("maturityDays", "Field maturity after planting/transplant (days)", "number", type.maturityDays),
    (payload) => {
      payload.requiresNursery = payload.requiresNursery === "true";
      for (const key of ["nurseryDays", "maturityDays"]) payload[key] = payload[key] === "" ? null : Number(payload[key]);
      return type.id ? api.patch(`/crops/types/${type.id}`, payload) : api.post("/crops/types", payload);
    });
}

export async function openCropModal(crop = {}) {
  try {
    const [farms, blocks, { data: types }] = await Promise.all([context.loadAll("/farms"), context.loadAll("/blocks"), api.get("/crops/types")]);
    const form = modal(crop.id ? "Edit crop cycle" : "Add crop cycle",
      `<div class="grid gap-4 sm:grid-cols-2">` +
      field("farmId", "Farm", "select", crop.farmId, { required: true, items: [["", "Select farm"], ...farms.map((farm) => [farm.id, farm.name])] }) +
      field("blockId", "Block / plot", "select", crop.blockId, { items: [["", "No block"], ...blocks.filter((block) => block.farmId === crop.farmId).map((block) => [block.id, block.name])] }) +
      field("cropTypeId", "Crop type defaults (optional)", "select", crop.cropTypeId, { items: [["", "Custom crop"], ...types.map((type) => [type.id, type.name])] }) +
      field("cropName", "Crop name", "text", crop.cropName, { required: true }) +
      field("variety", "Variety", "text", crop.variety) + field("acreage", "Area (acres)", "number", crop.acreage) +
      field("requiresNursery", "Requires nursery?", "select", String(crop.requiresNursery ?? false), { items: [["false", "No - direct planting"], ["true", "Yes - nursery then transplant"]] }) +
      field("nurseryDays", "Nursery duration (days)", "number", crop.nurseryDays) +
      field("nurseryDate", "Nursery sowing date", "date", day(crop.nurseryDate)) +
      field("plantingDate", "Field planting / planned transplant date", "date", day(crop.plantingDate)) +
      field("transplantDate", "Actual transplant date", "date", day(crop.transplantDate)) +
      field("yieldingDays", "Yielding days after field planting / transplant", "number", crop.yieldingDays) +
      field("expectedHarvest", "Expected harvest date", "date", day(crop.expectedHarvest)) +
      field("expectedYield", "Expected yield (kg)", "number", crop.expectedYield) +
      field("notes", "Notes", "textarea", crop.notes) + '</div><p data-schedule class="text-xs text-forest-700"></p><p class="text-xs text-slate-500">Dates are plans/observations, not automatic stage changes. New cycles start as planned.</p>',
      (payload) => {
        payload.requiresNursery = payload.requiresNursery === "true";
        for (const key of ["nurseryDays", "yieldingDays", "acreage", "expectedYield"]) payload[key] = payload[key] === "" ? null : Number(payload[key]);
        for (const key of ["blockId", "cropTypeId", "nurseryDate", "plantingDate", "transplantDate", "expectedHarvest"]) if (!payload[key]) payload[key] = null;
        return crop.id ? api.patch(`/crops/${crop.id}`, payload) : api.post("/crops", payload);
      });
    form.elements.farmId.onchange = () => {
      form.elements.blockId.innerHTML = `<option value="">No block</option>${blocks.filter((block) => block.farmId === form.elements.farmId.value).map((block) => `<option value="${block.id}">${esc(block.name)}</option>`).join("")}`;
    };
    let autoPlanting = !crop.plantingDate;
    let autoHarvest = !crop.expectedHarvest;
    function schedule() {
      const values = Object.fromEntries(new FormData(form));
      const nursery = values.requiresNursery === "true";
      form.elements.nurseryDate.required = nursery;
      form.elements.nurseryDays.required = nursery;
      const suggested = suggestCropSchedule(values);
      if (autoPlanting) form.elements.plantingDate.value = suggested.transplant;
      const harvest = suggestCropSchedule({ ...values, plantingDate: form.elements.plantingDate.value }).harvest;
      if (autoHarvest) form.elements.expectedHarvest.value = harvest;
      form.querySelector("[data-schedule]").textContent = [
        suggested.transplant ? `Suggested transplant: ${suggested.transplant} (${values.nurseryDays} nursery days).` : "",
        harvest ? `Suggested harvest: ${harvest} (${values.yieldingDays} yielding days after field planting/transplant).` : ""
      ].filter(Boolean).join(" ") + " Dates can be adjusted manually.";
    }
    form.elements.cropTypeId.onchange = () => {
      const type = types.find((item) => item.id === form.elements.cropTypeId.value);
      if (type) {
        form.elements.cropName.value = type.name;
        form.elements.requiresNursery.value = String(type.requiresNursery);
        form.elements.nurseryDays.value = type.nurseryDays ?? "";
        form.elements.yieldingDays.value = type.maturityDays ?? "";
        schedule();
      }
    };
    form.elements.plantingDate.addEventListener("input", () => { autoPlanting = !form.elements.plantingDate.value; });
    form.elements.expectedHarvest.addEventListener("input", () => { autoHarvest = !form.elements.expectedHarvest.value; });
    for (const key of ["requiresNursery", "nurseryDate", "nurseryDays", "yieldingDays", "plantingDate", "transplantDate", "expectedHarvest"]) form.elements[key].addEventListener("change", schedule);
    schedule();
  } catch (error) { context.showToast(error.message, "error"); }
}

async function renderCrop(id) {
  const [{ data: crop }, farms, blocks] = await Promise.all([api.get(`/crops/${id}`), context.loadAll("/farms"), context.loadAll("/blocks")]);
  const nurseryEnd = crop.requiresNursery && crop.nurseryDate && crop.nurseryDays ? new Date(new Date(crop.nurseryDate).getTime() + crop.nurseryDays * 86400000) : null;
  const nurseryDaysLeft = nurseryEnd ? Math.ceil((nurseryEnd - new Date()) / 86400000) : null;
  const daysLeft = crop.expectedHarvest ? Math.ceil((new Date(crop.expectedHarvest) - new Date()) / 86400000) : null;
  const harvests = crop.activities.filter((activity) => activity.type === "HARVEST");
  const totals = [...harvests.reduce((sum, record) => {
    const unit = record.unit === "OTHER" ? record.customUnit : record.unit;
    sum.set(unit, (sum.get(unit) || 0) + record.quantity);
    return sum;
  }, new Map())];
  content().innerHTML = `<a href="#crops" class="text-sm font-semibold">Back to crops</a><div class="my-5 flex flex-wrap justify-between gap-3"><div><h1 class="text-2xl font-semibold">${esc(crop.cropName)} ${esc(crop.variety || "")}</h1><p class="mt-2 text-sm text-slate-500">${esc(farms.find((farm) => farm.id === crop.farmId)?.name)} · ${esc(blocks.find((block) => block.id === crop.blockId)?.name || "No block")} · ${esc(label(crop.status))}</p></div>${canManageCrops() ? '<div class="flex flex-wrap gap-2"><button id="edit-crop" class="btn-secondary">Edit details</button><button id="change-stage" class="btn-primary">Change stage</button><button id="crop-activity" class="btn-secondary">Record activity</button><button id="archive-crop" class="btn-secondary">Archive</button></div>' : ""}</div>
    <div class="grid gap-4 sm:grid-cols-2"><section class="card"><h2 class="font-semibold">Schedule & monitoring</h2><dl class="mt-4 space-y-2 text-sm">
      <div>Nursery sowing: ${date(crop.nurseryDate)}</div><div>Nursery duration: ${crop.requiresNursery ? `${crop.nurseryDays} days` : "Not required"}</div><div>Suggested transplant: ${date(nurseryEnd)}</div>
      ${crop.status === "NURSERY" && nurseryDaysLeft !== null ? `<div class="font-semibold ${nurseryDaysLeft <= 0 ? "text-amber-700" : "text-forest-700"}">${nurseryDaysLeft <= 0 ? "Nursery period reached - review readiness for transplanting." : `${nurseryDaysLeft} days until the suggested transplant date.`}</div>` : ""}
      <div>Field planting / planned transplant: ${date(crop.plantingDate)}</div><div>Actual transplant: ${date(crop.transplantDate)}</div><div>Expected harvest: ${date(crop.expectedHarvest)}</div>
      <div>Yielding duration: ${crop.yieldingDays ?? "Not set"} days after field planting / transplant</div>
      <div>${daysLeft === null ? "Set a harvest date to monitor the schedule." : ["HARVESTED", "CANCELLED"].includes(crop.status) ? "Cycle closed." : daysLeft < 0 ? `${Math.abs(daysLeft)} days past expected harvest - review this crop.` : `${daysLeft} days until expected harvest.`}</div>
      <div>Expected yield: ${crop.expectedYield ?? "Not set"} kg</div></dl><p class="mt-4 whitespace-pre-wrap text-sm text-slate-500">${esc(crop.notes || "")}</p></section>
      <section class="card"><h2 class="font-semibold">Stage history</h2><p class="mt-1 text-xs text-slate-500">Stages are recorded manually from field observations. Corrections require a reason.</p><ol class="mt-4 space-y-3">${crop.stages.map((stage) => `<li class="border-l-2 border-forest-200 pl-3"><p class="text-sm font-semibold">${esc(label(stage.stage))}</p><p class="text-xs text-slate-500">${new Date(stage.occurredAt).toLocaleString()}</p><p class="mt-1 text-sm">${esc(stage.notes || "")}</p></li>`).join("")}</ol></section></div>
    <section class="card mt-5"><h2 class="font-semibold">Harvest totals</h2><p class="mt-2 text-sm">${totals.length ? totals.map(([unit, value]) => `${Number(value.toFixed(3)).toLocaleString()} ${esc(unit)}`).join(" · ") : "No harvests recorded"}</p><p class="mt-1 text-xs text-slate-500">Different units are kept separate. Harvest records do not automatically create sales or change stages.</p></section>
    <section class="card mt-5"><h2 class="font-semibold">Crop activity records</h2><div class="mt-4 space-y-3">${crop.activities.map((activity) => `<article class="rounded-xl border border-slate-100 p-3"><p class="text-sm font-semibold">${esc(activity.type === "CUSTOM" ? activity.customActivity : label(activity.type))} · ${activity.quantity} ${esc(activity.unit === "OTHER" ? activity.customUnit : activity.unit)} ${esc(activity.product || "")}</p><p class="text-xs text-slate-500">${date(activity.occurredAt)}</p><p class="mt-1 text-sm">${esc(activity.notes || "")}</p></article>`).join("") || '<p class="text-sm text-slate-500">No activities recorded yet.</p>'}</div></section>`;
  document.querySelector("#edit-crop")?.addEventListener("click", () => openCropModal(crop));
  document.querySelector("#change-stage")?.addEventListener("click", () => modal("Record stage change",
    field("stage", "Observed stage", "select", crop.status, { items: stages.filter((stage) => crop.requiresNursery || !["NURSERY", "TRANSPLANTED"].includes(stage)).map((stage) => [stage, label(stage)]) }) +
    '<p class="text-xs text-slate-500">Use a later observation time than the latest stage entry. A previous stage can be selected to correct a mistake; explain why.</p>' +
    field("occurredAt", "Observation time", "datetime-local", localTime(), { required: true }) +
    field("notes", "Observation / reason for change", "textarea", "", { required: true }),
    (payload) => api.post(`/crops/${id}/stages`, { ...payload, occurredAt: new Date(payload.occurredAt).toISOString() })));
  document.querySelector("#crop-activity")?.addEventListener("click", () => {
    const form = modal("Record crop activity",
      field("type", "Activity", "select", "IRRIGATION", { items: ["IRRIGATION", "FERTILIZER", "HARVEST", "CUSTOM"].map((type) => [type, label(type)]) }) +
      '<div data-custom-activity hidden>' + field("customActivity", "Specify activity", "text") + '</div>' +
      field("occurredAt", "Activity date", "date", day(new Date()), { required: true }) +
      field("quantity", "Quantity", "number", "", { required: true }) +
      field("unit", "Unit", "select", "litres", { items: [["litres", "litres"], ["m3", "m3"], ["mm", "mm"], ["OTHER", "Other / specify"]] }) +
      '<div data-custom-unit hidden>' + field("customUnit", "Specify unit", "text") + '</div>' +
      field("product", "Fertilizer product / harvest grade (optional)", "text") +
      field("notes", "Notes", "textarea"),
      (payload) => api.post(`/crops/${id}/activities`, { ...payload, quantity: Number(payload.quantity), customActivity: payload.type === "CUSTOM" ? payload.customActivity : null, customUnit: payload.unit === "OTHER" ? payload.customUnit : null }));
    function updateUnit() {
      const custom = form.elements.unit.value === "OTHER";
      form.querySelector("[data-custom-unit]").hidden = !custom;
      form.elements.customUnit.required = custom;
    }
    form.elements.unit.onchange = updateUnit;
    form.elements.type.onchange = () => {
      const units = { IRRIGATION: ["litres", "m3", "mm"], FERTILIZER: ["kg", "g", "litres"], HARVEST: ["kg", "tonnes", "bags", "crates", "pieces"], CUSTOM: ["pieces", "litres", "kg"] };
      form.elements.unit.innerHTML = units[form.elements.type.value].map((unit) => `<option>${unit}</option>`).join("") + '<option value="OTHER">Other / specify</option>';
      form.elements.product.required = form.elements.type.value === "FERTILIZER";
      form.elements.customActivity.required = form.elements.type.value === "CUSTOM";
      form.querySelector("[data-custom-activity]").hidden = form.elements.type.value !== "CUSTOM";
      updateUnit();
    };
  });
  document.querySelector("#archive-crop")?.addEventListener("click", async () => {
    if (!confirm("Archive this crop? Its history will be retained.")) return;
    try { context.showToast((await api.delete(`/crops/${id}`)).message); await context.navigate("crops"); }
    catch (error) { context.showToast(error.message, "error"); }
  });
}

function localTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
}
