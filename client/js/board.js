import { api } from "./api.js?v=0.12.0";
import { field, modal } from "./v03.js?v=0.12.0";

const canEdit = (user) => ["OWNER", "MANAGER"].includes(user.role);

function boardModal(board, onSaved) {
  modal("Update today's board",
    field("headline", "Headline / message for the team", "text", board.headline || "", { maxlength: 300 }) +
    field("items", "Today's list (one item per line)", "textarea", board.items.map((item) => item.text).join("\n")) +
    '<p class="text-xs text-slate-500">Everyone in the workspace sees this on their dashboard. Update it each day.</p>',
    async (values) => {
      const previous = new Map(board.items.map((item) => [item.text, item.done]));
      const items = String(values.items || "").split("\n").map((text) => text.trim()).filter(Boolean).slice(0, 30).map((text) => ({ text, done: previous.get(text) || false }));
      const response = await api.put("/board", { headline: values.headline || null, items });
      onSaved();
      return response;
    });
}

export async function mountBoard(target, { escapeHtml, getUser, showToast }) {
  if (!target) return;
  const esc = escapeHtml;
  try {
    const { data: board } = await api.get("/board");
    const user = getUser();
    const editable = canEdit(user);
    const updated = board.updatedAt ? `${new Date(board.updatedAt).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}${board.updatedBy ? ` by ${esc(board.updatedBy)}` : ""}` : "";
    const stale = board.updatedAt && new Date(board.updatedAt).toDateString() !== new Date().toDateString();
    target.innerHTML = `<section class="card mb-5 border-forest-200 bg-forest-50/60"><div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0"><p class="text-xs font-semibold uppercase tracking-wider text-forest-700">Today on the farm</p>${board.headline ? `<h2 class="mt-1 break-words text-lg font-semibold">${esc(board.headline)}</h2>` : ""}${updated ? `<p class="mt-1 text-xs ${stale ? "text-amber-700" : "text-slate-500"}">Updated ${updated}${stale ? " (not updated today)" : ""}</p>` : ""}</div>${editable ? '<button data-board-edit class="btn-secondary">Update board</button>' : ""}</div>${board.items.length ? `<ul class="mt-3 space-y-2">${board.items.map((item) => `<li class="flex items-start gap-2 text-sm"><span aria-hidden="true">${item.done ? "☑" : "☐"}</span><span class="${item.done ? "text-slate-400 line-through" : ""} break-words">${esc(item.text)}</span></li>`).join("")}</ul>` : `<p class="mt-2 text-sm text-slate-500">${board.headline ? "" : editable ? "Nothing posted yet. Use Update board to tell the team what is happening today." : "Nothing posted for today yet."}</p>`}</section>`;
    target.querySelector("[data-board-edit]")?.addEventListener("click", () => boardModal(board, () => mountBoard(target, { escapeHtml, getUser, showToast })));
  } catch (error) { target.innerHTML = ""; }
}