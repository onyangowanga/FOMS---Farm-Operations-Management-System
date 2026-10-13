import { api } from "./api.js?v=0.10.0";
import { field, modal } from "./v03.js?v=0.10.0";
import { localDateTime } from "./reports.js?v=0.10.0";

let context;
export function configureTasks(value) { context = value; }
const esc = (value) => context.escapeHtml(value);
const manage = () => ["OWNER", "MANAGER"].includes(context.getUser().role);
const worker = () => context.getUser().role === "WORKER";
const label = (value) => String(value).toLowerCase().replaceAll("_", " ");
const statuses = ["PENDING", "IN_PROGRESS", "COMPLETED", "APPROVED"];
const editable = (task) => ["PENDING", "IN_PROGRESS"].includes(task.status);
const date = (value) => value ? new Date(value).toLocaleString() : "Not set";

export async function openTaskModal(task = {}) {
  try {
    const [farms, team] = await Promise.all([context.loadAll("/farms"), api.get("/team")]);
    modal(task.id ? "Edit task" : "Create task",
      field("title", "Task title", "text", task.title || "", { required: true, maxlength: 160 }) +
      field("description", "Instructions", "textarea", task.description || "") +
      '<div class="grid gap-4 sm:grid-cols-2">' +
      field("farmId", "Farm", "select", task.farmId || "", { items: [["", "General workspace task"], ...farms.map((farm) => [farm.id, farm.name])] }) +
      field("assignedTo", "Assign to", "select", task.assignedTo || "", { items: [["", "Unassigned"], ...team.data.map((member) => [member.user.id, `${member.user.name} (${label(member.role)})`])] }) +
      field("priority", "Priority", "select", task.priority || "MEDIUM", { items: ["LOW", "MEDIUM", "HIGH", "URGENT"].map((value) => [value, label(value)]) }) +
      field("dueDate", "Due date and time", "datetime-local", task.dueDate ? localDateTime(new Date(task.dueDate)) : "") +
      field("category", "Category", "text", task.category || "", { maxlength: 100 }) +
      field("evidenceRequired", "Evidence requirement", "select", String(task.evidenceRequired || false), { items: [["false", "Optional"], ["true", "At least one photo or PDF required"]] }) +
      '</div><p class="text-xs text-slate-500">Reassignment returns a task to pending. Start it before submitting. Submitted tasks lock until a manager requests rework.</p>',
      (values) => {
        const payload = { ...values, farmId: values.farmId || null, assignedTo: values.assignedTo || null, description: values.description || null, category: values.category || null, dueDate: values.dueDate ? new Date(values.dueDate).toISOString() : null, evidenceRequired: values.evidenceRequired === "true" };
        return task.id ? api.patch(`/tasks/${task.id}`, payload) : api.post("/tasks", payload);
      });
  } catch (error) { context.showToast(error.message, "error"); }
}

function statusModal(task, status) {
  const rework = task.status === "COMPLETED" && status === "IN_PROGRESS";
  const title = rework ? "Request rework" : status === "COMPLETED" ? "Submit for approval" : status === "APPROVED" ? "Approve task" : "Start task";
  modal(title, `<p class="break-words text-sm">${esc(task.title)}</p>` +
    field("notes", rework ? "What needs rework?" : status === "COMPLETED" ? "Completion notes" : "Notes (optional)", "textarea", "", { required: rework }) +
    (status === "COMPLETED" ? `<p class="text-xs text-slate-500">${task.evidenceRequired ? "At least one attached photo or PDF is required." : "Evidence is optional for this task."} Evidence uploads are available on the task detail page.</p>` : ""),
    (values) => api.post(`/tasks/${task.id}/status`, { status, notes: values.notes || null }));
}

function uploadModal(task) {
  modal("Upload task evidence", '<label class="block"><span class="label">Photo or PDF (maximum 10 MB)</span><input class="field" type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label><p class="text-xs text-slate-500">Files are private to users who can access this task. Up to 10 active files per task. A connection is required to upload.</p>',
    (_values, form) => {
      const file = form.elements.file.files[0];
      if (!file) throw new Error("Select an evidence photo or PDF");
      if (file.size > 10 * 1024 * 1024) throw new Error("Evidence cannot exceed 10 MB");
      const payload = new FormData();
      payload.set("file", file);
      return api.upload(`/tasks/${task.id}/evidence`, payload);
    });
}

async function detail(id) {
  const [response, evidence, events] = await Promise.all([api.get(`/tasks/${id}`), api.get(`/tasks/${id}/evidence`), context.loadAll(`/tasks/${id}/events`)]);
  const task = response.data;
  const canAct = manage() || worker();
  const root = document.querySelector("#content");
  const overdue = task.dueDate && new Date(task.dueDate) < new Date() && !["COMPLETED", "APPROVED"].includes(task.status);
  root.innerHTML = `
    <a href="#tasks" class="text-sm font-medium text-forest-700">Back to tasks</a>
    <div class="my-5 flex flex-wrap justify-between gap-3">
      <div class="w-full min-w-0 max-w-full sm:flex-1">
        <h1 class="break-words text-2xl font-semibold">${esc(task.title)}</h1>
        <p class="mt-2 break-words text-sm text-slate-500">${esc(task.farm?.name || "General workspace")} - ${esc(label(task.status))} - ${esc(label(task.priority))} priority</p>
      </div>
      <div class="flex flex-wrap gap-2">
        ${manage() && editable(task) ? '<button data-edit class="btn-secondary">Edit task</button>' : ""}
        ${manage() ? '<button data-archive class="btn-secondary">Archive</button>' : ""}
      </div>
    </div>
    <section class="card min-w-0 break-words">
      <div class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <p class="min-w-0 text-sm"><strong>Assigned to:</strong> ${esc(task.assignee?.name || "Unassigned")}</p>
        <p class="min-w-0 text-sm ${overdue ? "text-red-700" : ""}"><strong>Due:</strong> ${esc(date(task.dueDate))}${overdue ? " (overdue)" : ""}</p>
        <p class="min-w-0 text-sm"><strong>Evidence:</strong> ${task.evidenceRequired ? "Required before submission" : "Optional"}</p>
        <p class="min-w-0 text-sm"><strong>Category:</strong> ${esc(task.category || "Not set")}</p>
      </div>
      ${task.description ? `<p class="mt-4 whitespace-pre-wrap break-words text-sm">${esc(task.description)}</p>` : ""}
      ${task.submissionNotes ? `<p class="mt-4 whitespace-pre-wrap break-words text-sm"><strong>Completion notes:</strong> ${esc(task.submissionNotes)}</p>` : ""}
      ${task.completedAt ? `<p class="mt-3 text-xs text-slate-500">Submitted: ${esc(date(task.completedAt))}</p>` : ""}
      ${task.approvedAt ? `<p class="mt-2 text-xs text-slate-500">Approved: ${esc(date(task.approvedAt))}</p>` : ""}
      <div class="mt-4 flex flex-wrap gap-2">
        ${canAct && task.status === "PENDING" ? '<button data-status="IN_PROGRESS" class="btn-primary">Start task</button>' : ""}
        ${canAct && task.status === "IN_PROGRESS" ? '<button data-status="COMPLETED" class="btn-primary">Submit for approval</button>' : ""}
        ${manage() && task.status === "COMPLETED" ? '<button data-status="APPROVED" class="btn-primary">Approve task</button><button data-status="IN_PROGRESS" class="btn-secondary">Request rework</button>' : ""}
      </div>
    </section>
    <section class="card mt-5">
      <div class="flex flex-wrap justify-between gap-3"><h2 class="text-lg font-semibold">Task evidence</h2>${canAct && editable(task) ? '<button data-upload class="btn-secondary">Upload evidence</button>' : ""}</div>
      <div class="mt-4 space-y-3">
        ${evidence.data.map((file) => `<div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 p-3"><a class="min-w-0 max-w-full break-words text-sm font-medium text-forest-700" href="${esc(file.downloadPath)}" download>${esc(file.originalName)}</a>${editable(task) && (manage() || (worker() && file.uploadedBy === context.getUser().user.id)) ? `<button data-remove="${file.id}" class="btn-secondary">Remove</button>` : ""}</div>`).join("") || '<p class="text-sm text-slate-500">No evidence attached yet.</p>'}
        ${task.evidenceUrl && /^https?:\/\//i.test(task.evidenceUrl) ? `<a href="${esc(task.evidenceUrl)}" target="_blank" rel="noopener noreferrer" class="block break-words text-sm text-forest-700">Legacy external evidence link</a>` : ""}
      </div>
    </section>
    <h2 class="mb-3 mt-6 text-lg font-semibold">Workflow history</h2>
    <div class="space-y-3">
      ${events.map((event) => `<article class="card"><div class="flex flex-wrap justify-between gap-2"><h3 class="min-w-0 break-words font-semibold">${esc(label(event.action))}</h3><time class="text-xs text-slate-500">${esc(date(event.createdAt))}</time></div>${event.toStatus ? `<p class="mt-2 text-sm">${event.fromStatus ? `${esc(label(event.fromStatus))} to ` : ""}${esc(label(event.toStatus))}</p>` : ""}${event.notes ? `<p class="mt-2 whitespace-pre-wrap break-words text-sm">${esc(event.notes)}</p>` : ""}</article>`).join("") || '<div class="card text-sm text-slate-500">No workflow history yet. Legacy task status has been preserved.</div>'}
    </div>`;
  root.querySelector("[data-edit]")?.addEventListener("click", () => openTaskModal(task));
  root.querySelector("[data-upload]")?.addEventListener("click", () => uploadModal(task));
  root.querySelectorAll("[data-status]").forEach((button) => button.onclick = () => statusModal(task, button.dataset.status));
  root.querySelectorAll("[data-remove]").forEach((button) => button.onclick = async () => {
    if (!confirm("Remove this evidence from the active submission?")) return;
    try { const response = await api.delete(`/tasks/${task.id}/evidence/${button.dataset.remove}`); context.showToast(response.message); await context.reload(); }
    catch (error) { context.showToast(error.message, "error"); }
  });
  root.querySelector("[data-archive]")?.addEventListener("click", async () => {
    if (!confirm("Archive this task? Its workflow history and files will be retained.")) return;
    try { const response = await api.delete(`/tasks/${task.id}`); context.showToast(response.message); await context.navigate("tasks"); }
    catch (error) { context.showToast(error.message, "error"); }
  });
}

export async function renderTasks(id) {
  if (id) return detail(id);
  const records = await context.loadAll("/tasks");
  const root = document.querySelector("#content");
  root.innerHTML = `<div class="mb-5 flex flex-wrap justify-between gap-3"><div><h1 class="text-2xl font-semibold">${worker() ? "My assigned tasks" : "Task management"}</h1><p class="mt-2 text-sm text-slate-500">Start work, attach evidence, submit and review.</p></div>${manage() ? '<button data-new class="btn-primary">Create task</button>' : ""}</div><div class="mb-4 grid gap-3 sm:grid-cols-2">${field("statusFilter", "Status", "select", "", { items: [["", "All statuses"], ...statuses.map((value) => [value, label(value)])] })}${field("searchTasks", "Search tasks", "search")}</div><div data-task-list class="grid gap-4 xl:grid-cols-2"></div>`;
  const update = () => {
    const status = root.querySelector('[name=statusFilter]').value;
    const search = root.querySelector('[name=searchTasks]').value.trim().toLowerCase();
    const items = records.filter((task) => (!status || task.status === status) && (!search || `${task.title} ${task.assignee?.name || ""} ${task.farm?.name || ""}`.toLowerCase().includes(search)));
    root.querySelector("[data-task-list]").innerHTML = items.map((task) => `<a href="#tasks/${task.id}" class="card block min-w-0 text-slate-800 hover:border-forest-500"><h2 class="break-words font-semibold">${esc(task.title)}</h2><p class="mt-2 text-sm">${esc(label(task.status))} - ${esc(label(task.priority))} priority</p><p class="mt-2 break-words text-sm text-slate-500">${esc(task.assignee?.name || "Unassigned")} - ${esc(task.farm?.name || "General workspace")}</p><p class="mt-2 text-xs ${task.dueDate && new Date(task.dueDate) < new Date() && editable(task) ? "text-red-700" : "text-slate-500"}">Due: ${esc(date(task.dueDate))}</p>${task.evidenceRequired ? '<p class="mt-2 text-xs text-forest-700">Evidence required</p>' : ""}</a>`).join("") || '<div class="card text-sm text-slate-500">No tasks match these filters.</div>';
  };
  root.querySelector("[data-new]")?.addEventListener("click", () => openTaskModal());
  root.querySelector("select").addEventListener("change", update);
  root.querySelector('[name=searchTasks]').addEventListener("input", update);
  update();
}
