import { api } from "./api.js?v=0.6.0";

let context;
let timer;
export function configureNotifications(value) { context = value; }
const esc = (value) => context.escapeHtml(value);
function eligible() {
  const user = context.getUser();
  return user && user.role !== "FOMS_ADMIN" && !user.passwordChangeRequired;
}
export async function refreshNotifications() {
  const badge = document.querySelector("#notification-count");
  if (!badge || !eligible()) return;
  try {
    const response = await api.get("/notifications?limit=1");
    if (!document.contains(badge)) return;
    badge.textContent = String(response.meta.unread);
    badge.title = `${response.meta.unread} unread notifications`;
  } catch (error) {
    if (document.contains(badge)) { badge.textContent = "!"; badge.title = error.message; }
    console.error("Notification inbox refresh failed", error);
  }
}
export function attachNotifications() {
  clearInterval(timer);
  document.querySelector("#open-notifications")?.addEventListener("click", openInbox);
  if (!eligible()) return;
  refreshNotifications();
  timer = setInterval(() => { if (eligible() && navigator.onLine) refreshNotifications(); else if (!eligible()) clearInterval(timer); }, 60000);
}
async function openInbox() {
  const root = document.querySelector("#inbox-root");
  try {
    const data = await context.loadAll("/notifications");
    root.innerHTML = `<div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-5"><section role="dialog" aria-modal="true" aria-labelledby="inbox-title" class="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-2xl"><div class="flex flex-wrap justify-between gap-2"><h2 id="inbox-title" class="text-xl font-semibold">Notifications</h2><button data-close class="btn-secondary">Close</button></div><button data-read-all class="btn-secondary mt-4">Mark all read</button><div class="mt-4 space-y-3">${data.map((item) => `<article class="min-w-0 rounded-xl border p-3 ${item.readAt ? "border-slate-100" : "border-forest-500 bg-forest-50"}"><p class="whitespace-pre-wrap break-words text-sm">${esc(item.message)}</p><time class="mt-2 block text-xs text-slate-500">${esc(new Date(item.createdAt).toLocaleString())}</time><div class="mt-3 flex flex-wrap gap-2"><button data-task="${item.taskId}" data-id="${item.id}" class="btn-secondary">View task</button>${!item.readAt ? `<button data-read="${item.id}" class="btn-secondary">Mark read</button>` : ""}</div></article>`).join("") || '<p class="text-sm text-slate-500">No task notifications yet.</p>'}</div><p data-inbox-error role="alert" class="mt-3 text-sm text-red-700"></p></section></div>`;
    root.querySelector("[data-close]").onclick = () => { root.innerHTML = ""; };
    root.querySelector("[data-read-all]").onclick = async () => {
      try { await api.post("/notifications/read-all", {}); await refreshNotifications(); await openInbox(); }
      catch (error) { root.querySelector("[data-inbox-error]").textContent = error.message; }
    };
    root.querySelectorAll("[data-read]").forEach((button) => button.onclick = async () => {
      try { await api.patch(`/notifications/${button.dataset.read}`, { read: true }); await refreshNotifications(); await openInbox(); }
      catch (error) { root.querySelector("[data-inbox-error]").textContent = error.message; }
    });
    root.querySelectorAll("[data-task]").forEach((button) => button.onclick = async () => {
      try {
        await api.patch(`/notifications/${button.dataset.id}`, { read: true });
        root.innerHTML = "";
        const hash = `#tasks/${button.dataset.task}`;
        if (location.hash === hash) await context.reload();
        else location.hash = hash;
        await refreshNotifications();
      } catch (error) { root.querySelector("[data-inbox-error]").textContent = error.message; }
    });
    root.querySelector("[data-close]").focus();
  } catch (error) { context.showToast(error.message, "error"); }
}
