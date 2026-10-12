import { api, setOfflineIdentity, syncOutbox } from "./api.js?v=0.7.0";
import { configureV03, renderClients, renderTeam as renderWorkspaceTeam, renderAccount, renderSetup, renderCrops, openCropModal } from "./v03.js?v=0.7.0";
import { offlineStore } from "./offline.js";
import { configureReports, renderReports, openDailyReport } from "./reports.js?v=0.7.0";
import { configureLivestock, renderLivestock, openLivestockModal } from "./livestock.js?v=0.7.0";
import { configureTasks, renderTasks, openTaskModal } from "./tasks.js?v=0.7.0";
import { configureNotifications, attachNotifications, refreshNotifications } from "./notifications.js?v=0.7.0";
import { configureInventory, renderInventory as renderStockInventory, openInventoryModal as openStockItemModal } from "./inventory.js?v=0.7.0";

const app = document.querySelector("#app");
const toastRoot = document.querySelector("#toast-root");
const navGroups = [
  { title: "OVERVIEW", items: [["dashboard", "◫", "Dashboard"], ["structure", "▦", "Farm structure"]] },
  { title: "FARM OPERATIONS", items: [["farms", "⌂", "Farms"], ["blocks", "▦", "Blocks"], ["crops", "❋", "Crops"], ["livestock", "♧", "Livestock"], ["tasks", "☑", "Tasks"], ["journal", "▤", "Daily reports"]] },
  { title: "MANAGEMENT", items: [["inventory", "▤", "Inventory"], ["sales", "$", "Sales & invoices"], ["expenses", "↗", "Expenses"], ["documents", "▧", "Documents"], ["team", "♙", "Team"], ["account", "⚙", "Account"]] }
];
const config = {
  farms: { title: "Farms", singular: "farm", endpoint: "farms", roles: ["OWNER", "MANAGER"], fields: [["name", "Farm name", "text", true], ["location", "Location", "text"], ["acreage", "Total acreage", "number"], ["latitude", "Latitude", "number"], ["longitude", "Longitude", "number"], ["description", "Notes", "textarea"]], columns: [["name", "Farm"], ["location", "Location"], ["acreage", "Acres"], ["latitude", "Latitude"], ["longitude", "Longitude"]] },
  blocks: { title: "Farm blocks", singular: "block", endpoint: "blocks", roles: ["OWNER", "MANAGER"], fields: [["farmId", "Farm", "farm", true], ["name", "Block name", "text", true], ["acreage", "Area (acres)", "number"], ["latitude", "Latitude", "number"], ["longitude", "Longitude", "number"], ["currentUse", "Current use", "text"], ["soilType", "Soil type", "text"]], columns: [["name", "Block"], ["farmId", "Farm"], ["acreage", "Acres"], ["currentUse", "Current use"], ["soilType", "Soil type"]] },
  crops: { title: "Crop management", singular: "crop cycle", endpoint: "crops", roles: ["OWNER", "MANAGER", "AGRONOMIST"] },
  livestock: { title: "Livestock", singular: "livestock record", endpoint: "livestock", roles: ["OWNER", "MANAGER"] },
  tasks: { title: "Tasks", singular: "task", endpoint: "tasks", roles: ["OWNER", "MANAGER"] },
  journal: { title: "Daily reports", singular: "daily report", endpoint: "journal", roles: ["OWNER", "MANAGER", "AGRONOMIST", "WORKER"] },
  expenses: { title: "Expenses", singular: "expense", endpoint: "expenses", roles: ["OWNER", "MANAGER"], fields: [["description", "Description", "text", true], ["farmId", "Farm", "farm"], ["category", "Category", "select", true, ["LABOR", "SEED", "FERTILIZER", "CHEMICALS", "FEED", "TRANSPORT", "VETERINARY", "FUEL", "REPAIRS", "OTHER"]], ["amount", "Amount (KES)", "number", true], ["supplier", "Supplier", "text"], ["expenseDate", "Date", "date"], ["paymentMethod", "Payment method", "text"], ["notes", "Notes", "textarea"]], columns: [["description", "Expense"], ["category", "Category"], ["supplier", "Supplier"], ["amount", "Amount"], ["expenseDate", "Date"], ["approvedAt", "Approval"]] }
};

let currentUser;
let currentPage = "dashboard";
let mobileOpen = false;
let farms = [];
let teamMembers = [];
let blocks = [];
let selectedFarmId = "";
let tableObserver;

function allowedPages() {
  if (currentUser.passwordChangeRequired) return ["account"];
  if (currentUser.role === "FOMS_ADMIN") return ["clients", "account"];
  if (currentUser.role === "WORKER") return ["dashboard", "tasks", "journal", "account"];
  return navGroups.flatMap((group) => group.items.map(([page]) => page)).filter((page) =>
    (!["expenses", "sales", "team"].includes(page) || ["OWNER", "MANAGER"].includes(currentUser.role)) &&
    (page !== "livestock" || currentUser.role !== "AGRONOMIST"));
}

async function loadAll(path) {
  const separator = path.includes("?") ? "&" : "?";
  const records = [];
  let page = 1;
  let response;
  do {
    response = await api.get(`${path}${separator}limit=100&page=${page++}`);
    records.push(...response.data);
  } while (records.length < response.meta.total);
  return records;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function showToast(message, type = "success") {
  const element = document.createElement("div");
  element.className = `pointer-events-auto rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${type === "error" ? "bg-red-600 text-white" : "bg-forest-700 text-white"}`;
  element.textContent = message;
  toastRoot.append(element);
  window.setTimeout(() => element.remove(), 3500);
}

function icon(symbol, extra = "") {
  return `<span aria-hidden="true" class="inline-flex h-5 w-5 items-center justify-center text-lg ${extra}">${symbol}</span>`;
}

function renderAuth() {
  app.innerHTML = `
    <main class="flex min-h-screen bg-white">
      <section class="hidden w-1/2 flex-col justify-between bg-forest-900 p-12 text-white lg:flex">
        <a class="text-xl font-bold tracking-tight" href="/">FOMS<span class="ml-2 text-sm font-normal text-forest-100">Farm Operations</span></a>
        <div class="max-w-lg">
          <div class="mb-6 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-100">GROW WITH CLARITY</div>
          <h1 class="text-5xl font-semibold leading-tight">Your farm, in good hands.</h1>
          <p class="mt-5 max-w-md text-lg leading-8 text-emerald-100/75">Bring your crops, livestock, people and farm finances together in one simple workspace.</p>
        </div>
        <p class="text-xs text-emerald-100/60">Built for the people who grow our future.</p>
      </section>
      <section class="flex flex-1 items-center justify-center px-6 py-12">
        <form id="auth-form" class="w-full max-w-md">
          <a class="mb-12 inline-block text-xl font-bold tracking-tight text-forest-700 lg:hidden" href="/">FOMS</a>
          <p class="text-sm font-semibold text-forest-600">WELCOME BACK</p>
          <h2 class="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Sign in to FOMS</h2>
          <p class="mt-2 text-sm text-slate-500">Enter your username and password to access your workspace.</p>
          <div class="mt-8 space-y-4">
            <label class="block"><span class="label">Username</span><input name="username" class="field" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
            <label class="block"><span class="label">Password</span><input name="password" class="field" type="password" autocomplete="current-password" required></label>
          </div>
          <button class="btn-primary mt-7 w-full py-3" type="submit">Sign in <span aria-hidden="true">→</span></button>
          <p class="mt-6 text-center text-sm text-slate-500">Accounts are provided by your workspace administrator.</p>
          <p id="auth-error" class="mt-4 hidden rounded-xl bg-red-50 p-3 text-sm text-red-700"></p>
        </form>
      </section>
    </main>`;
  document.querySelector("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const form = Object.fromEntries(new FormData(event.currentTarget));
      const response = await api.post("/auth/login", form);
      currentUser = response.data;
      mobileOpen = false;
      currentPage = currentUser.passwordChangeRequired ? "account" : currentUser.role === "FOMS_ADMIN" ? "clients" : "dashboard";
      history.replaceState(null, "", `#${currentPage}`);
      setOfflineIdentity({ organizationId: currentUser.organization.id, userId: currentUser.user.id, role: currentUser.role });
      await renderApp();
    } catch (error) {
      const message = document.querySelector("#auth-error");
      if (message) {
        message.textContent = error.message;
        message.classList.remove("hidden");
      } else showToast(error.message, "error");
    } finally { button.disabled = false; }
  });
}

function shell() {
  const initials = currentUser.user.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  const visibleNavGroups = currentUser.passwordChangeRequired ? [{ title: "PASSWORD RESET", items: [["account", "⚙", "Set new password"]] }] : currentUser.role === "FOMS_ADMIN" ? [{ title: "ADMINISTRATION", items: [["clients", "♙", "Clients"], ["account", "⚙", "Account"]] }] : navGroups.map((group) => ({
    ...group,
    items: group.items.filter(([page]) => allowedPages().includes(page))
  }));
  app.innerHTML = `
    <div class="min-h-screen lg:flex">
      <div id="mobile-backdrop" class="${mobileOpen ? "fixed inset-0 z-30 bg-slate-950/30 lg:hidden" : "hidden"}"></div>
      <aside class="${mobileOpen ? "fixed inset-y-0 left-0 z-40 flex w-72 flex-col" : "hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col"} border-r border-forest-700 bg-forest-900 px-4 py-5 text-white">
        <div class="flex items-center gap-3 px-2">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-forest-600 text-lg font-bold text-white">F</div>
          <div><div class="font-bold tracking-tight text-white">FOMS</div><div class="text-[11px] text-emerald-100">Farm Operations</div></div>
          <button id="close-mobile" class="ml-auto rounded-lg p-2 text-emerald-100 hover:bg-forest-700 hover:text-white lg:hidden" aria-label="Close menu">✕</button>
        </div>
        <div class="mx-1 mt-7 rounded-xl bg-forest-700 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-wider text-emerald-100">WORKSPACE</p>
          <p class="mt-1 truncate text-sm font-semibold text-white">${escapeHtml(currentUser.organization.name)}</p>
          <p class="mt-1 text-xs capitalize text-emerald-100">${escapeHtml(currentUser.role.toLowerCase())}</p>
        </div>
        <nav class="scrollbar-none mt-7 flex-1 space-y-6 overflow-y-auto">
          ${visibleNavGroups.filter((group) => group.items.length).map((group) => `<div><p class="mb-2 px-3 text-[10px] font-bold tracking-[.12em] text-emerald-200">${group.title}</p><div class="space-y-1">${group.items.map(([page, symbol, title]) => `<button data-page="${page}" ${currentPage === page ? 'aria-current="page"' : ""} class="nav-link w-full ${currentPage === page ? "active" : ""}">${icon(symbol)}<span>${title}</span></button>`).join("")}</div></div>`).join("")}
        </nav>
        <div class="mt-4 border-t border-forest-700 pt-4">
          <div class="flex items-center gap-3 rounded-xl p-2">
            <div class="flex h-9 w-9 items-center justify-center rounded-full bg-forest-50 text-xs font-bold text-forest-700">${escapeHtml(initials)}</div>
            <div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">${escapeHtml(currentUser.user.name)}</p><p class="truncate text-xs text-emerald-100">${escapeHtml(currentUser.user.username)}</p></div>
            <button id="logout" class="rounded-lg p-2 text-emerald-100 hover:bg-forest-700 hover:text-white" aria-label="Sign out">↪</button>
          </div>
          <div id="connection-status" class="mt-2 px-2 text-xs text-emerald-200"></div>
        </div>
      </aside>
      <main class="min-h-screen min-w-0 flex-1 lg:ml-64">
        <header class="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-slate-100 bg-white/95 px-4 backdrop-blur sm:px-7">
          <div class="flex items-center gap-3"><button id="open-mobile" class="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">☰</button><p class="hidden text-sm text-slate-400 sm:block">${escapeHtml(currentUser.organization.name)} <span class="mx-1">/</span></p><span class="text-sm font-semibold text-slate-800">${visibleNavGroups.flatMap((group) => group.items).find(([page]) => page === currentPage)?.[2] || "Dashboard"}</span></div>
          <div class="flex items-center gap-3">${currentUser.role !== "FOMS_ADMIN" && !currentUser.passwordChangeRequired ? '<button id="open-notifications" class="rounded-lg px-2 py-1 text-xs font-semibold text-forest-700" aria-label="Open notifications">Inbox <span id="notification-count" class="ml-1 rounded-full bg-forest-50 px-2 py-1">0</span></button>' : ""}<span id="sync-indicator" class="hidden rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 sm:inline-flex"></span><span class="hidden text-xs text-slate-400 sm:inline">${new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</span><div class="flex h-9 w-9 items-center justify-center rounded-full bg-forest-50 text-xs font-bold text-forest-700">${escapeHtml(initials)}</div></div>
        </header>
        <div id="content" class="mx-auto max-w-[1440px] p-4 sm:p-7"></div>
      </main>
      <div id="modal-root"></div>
      <div id="inbox-root"></div>
    </div>`;
  tableObserver?.disconnect();
  attachNotifications();
  tableObserver = new MutationObserver(makeTablesResponsive);
  for (const target of ["#content", "#modal-root"]) tableObserver.observe(document.querySelector(target), { childList: true, subtree: true });
  document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.page)));
  document.querySelector("#open-mobile").addEventListener("click", () => { mobileOpen = true; renderApp(); });
  document.querySelector("#close-mobile")?.addEventListener("click", () => { mobileOpen = false; renderApp(); });
  document.querySelector("#mobile-backdrop")?.addEventListener("click", () => { mobileOpen = false; renderApp(); });
  document.querySelector("#logout").addEventListener("click", async () => {
    try {
      await api.post("/auth/logout", {});
    } catch (error) {
      showToast(`Sign-out could not reach the server: ${error.message}`, "error");
    }
    currentUser = null;
    mobileOpen = false;
    setOfflineIdentity(null);
    renderAuth();
  });
}

async function renderApp() {
  if (!allowedPages().includes(currentPage)) {
    currentPage = allowedPages()[0];
    history.replaceState(null, "", `#${currentPage}`);
  }
  shell();
  updateConnectivity();
  await renderPage();
  setupConnectivity();
}

async function navigate(page) {
  if (!allowedPages().includes(page)) {
    showToast("You do not have access to this page.", "error");
    return;
  }
  currentPage = page;
  history.replaceState(null, "", `#${page}`);
  mobileOpen = false;
  shell();
  await renderPage();
}

function metric(title, value, subtitle, symbol, tint = "bg-forest-50 text-forest-700", page = "dashboard") {
  return `<a href="#${page}" class="card block p-3 text-slate-800 transition hover:border-forest-500 focus-visible:ring-2 focus-visible:ring-forest-500 sm:p-5"><div class="flex items-start justify-between gap-1"><div class="min-w-0"><p class="text-xs font-medium text-slate-500 sm:text-sm">${title}</p><p class="mt-2 break-words text-lg font-semibold tracking-tight text-slate-900 sm:mt-3 sm:text-3xl">${value}</p><p class="mt-2 text-[10px] text-slate-500 sm:text-xs">${subtitle}</p></div><div class="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl sm:flex ${tint}">${icon(symbol)}</div></div></a>`;
}

async function renderDashboard() {
  const { data } = await api.get("/dashboard");
  const content = document.querySelector("#content");
  if (currentUser.role === "WORKER") {
    content.innerHTML = `<div class="mb-6 flex flex-wrap justify-between gap-3"><div><h1 class="text-2xl font-semibold">Your work today</h1><p class="mt-2 text-sm text-slate-500">Assigned tasks and your daily farm observations.</p></div><button id="worker-quick-add" class="btn-primary">Quick add daily report</button></div><div class="grid grid-cols-2 gap-3">${metric("Pending tasks", data.tasks.pending, "Assigned to you", "", undefined, "tasks")}${metric("In progress", data.tasks.inProgress, "Assigned to you", "", undefined, "tasks")}${metric("Completed tasks", data.tasks.completed + data.tasks.approved, "Submitted / approved", "", undefined, "tasks")}${metric("Daily reports", data.reportCount, "Your recorded observations", "", undefined, "journal")}</div><section class="card mt-5"><h2 class="font-semibold">Record today's observations</h2><p class="mt-2 text-sm text-slate-500">Choose a crop, livestock or general farm observation, add a date and time, and optionally take or upload a photo.</p><button id="worker-report" class="btn-primary mt-4">Add daily report</button></section>`;
    content.querySelector("#worker-quick-add").onclick = () => openDailyReport();
    content.querySelector("#worker-report").onclick = () => openDailyReport();
    return;
  }
  const totalAnimals = Object.values(data.livestock).reduce((sum, count) => sum + count, 0);
  content.innerHTML = `
    <div class="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p class="text-sm font-medium text-forest-600">FARM OVERVIEW</p><h1 class="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${escapeHtml(currentUser.user.name.split(" ")[0])}</h1><p class="mt-2 text-sm text-slate-500">Here's what's happening across your farm today.</p></div><button id="quick-add" class="btn-primary">${icon("+")} Quick add</button></div>
    <div class="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      ${metric("Farm acreage", `${Number(data.totalAcreage).toLocaleString()} <span class="text-base font-medium text-slate-400">ac</span>`, `${data.farmCount} ${data.farmCount === 1 ? "farm" : "farms"} · ${data.blockCount} blocks`, "⌂", undefined, "farms")}
      ${metric("Active crop cycles", data.activeCropCount, `${data.cropCount} crop records`, "❋", "bg-amber-50 text-amber-700", "crops")}
      ${currentUser.role !== "AGRONOMIST" ? metric("Livestock", totalAnimals.toLocaleString(), `${data.livestock.goat || 0} goats · ${data.livestock.sheep || 0} sheep · ${data.livestock.poultry || 0} poultry`, "♧", "bg-sky-50 text-sky-700", "livestock") : ""}
      ${metric("Low stock items", data.lowStockItems, "At or below reorder level", "!", "bg-amber-50 text-amber-700", "inventory")}
      ${["OWNER", "MANAGER"].includes(currentUser.role) ? metric("Monthly revenue", `KES ${Number(data.monthlyRevenue).toLocaleString()}`, `${data.monthlySalesCount} invoices · ${Number(data.monthlyCollected).toLocaleString()} collected`, "$", "bg-emerald-50 text-emerald-700", "sales") : ""}
      ${["OWNER", "MANAGER"].includes(currentUser.role) ? metric("Net profit", `KES ${Number(data.monthlyProfit).toLocaleString()}`, "Revenue less expenses this month", "↗", "bg-sky-50 text-sky-700", "sales") : ""}
      ${["OWNER", "MANAGER"].includes(currentUser.role) ? metric("Monthly expenses", `KES ${Number(data.monthlyExpenses).toLocaleString()}`, "Total recorded this month", "↘", "bg-rose-50 text-rose-700", "expenses") : ""}
    </div>
    <div class="mt-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <section class="card"><div class="flex items-center justify-between"><div><h2 class="font-semibold text-slate-900">Crop progress</h2><p class="mt-1 text-xs text-slate-400">Your latest crop cycles</p></div><button data-goto="crops" class="text-xs font-semibold text-forest-700 hover:underline">View crops →</button></div>
        ${data.crops.length ? `<div class="mt-5 divide-y divide-slate-100">${data.crops.map((crop) => `<a href="#crops/${crop.id}" class="flex items-center gap-3 rounded-lg py-3 text-slate-800 hover:bg-forest-50 focus-visible:ring-2 focus-visible:ring-forest-500"><div class="flex h-10 w-10 items-center justify-center rounded-xl bg-forest-50 text-forest-600">❋</div><div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">${escapeHtml(crop.cropName)}</p><p class="mt-1 text-xs text-slate-400">${crop.acreage ? `${crop.acreage} acres` : "Area not set"}${crop.expectedHarvest ? ` · Harvest ${new Date(crop.expectedHarvest).toLocaleDateString()}` : ""}</p></div><span class="rounded-full bg-forest-50 px-2.5 py-1 text-[11px] font-semibold text-forest-700">${escapeHtml(crop.status.toLowerCase().replaceAll("_", " "))}</span></a>`).join("")}</div>` : `<div class="py-12 text-center"><div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-forest-50 text-forest-600">❋</div><p class="mt-4 text-sm font-semibold">No crop cycles yet</p><p class="mt-1 text-xs text-slate-400">Add your first crop record to start tracking progress.</p>${["OWNER", "MANAGER", "AGRONOMIST"].includes(currentUser.role) ? '<button data-create="crops" class="btn-secondary mt-4">Add a crop</button>' : ""}</div>`}
      </section>
      <section class="card"><div class="flex items-center justify-between"><div><h2 class="font-semibold text-slate-900">Tasks at a glance</h2><p class="mt-1 text-xs text-slate-400">Work across your farm</p></div><button data-goto="tasks" class="text-xs font-semibold text-forest-700 hover:underline">View tasks →</button></div>
        <div class="mt-5 space-y-3">${[["pending", "Pending", "bg-amber-400"], ["inProgress", "In progress", "bg-sky-500"], ["completed", "Completed", "bg-forest-500"], ["approved", "Approved", "bg-violet-500"]].map(([key, title, color]) => `<div class="flex items-center gap-3"><span class="h-2 w-2 rounded-full ${color}"></span><span class="flex-1 text-sm text-slate-600">${title}</span><span class="text-sm font-semibold">${data.tasks[key]}</span></div>`).join("")}</div>
        ${["OWNER", "MANAGER"].includes(currentUser.role) ? `<button data-create="tasks" class="btn-secondary mt-6 w-full">＋ Create a task</button>` : ""}
      </section>
    </div>
    <section class="mt-5 rounded-2xl bg-forest-900 p-5 text-white sm:p-7"><div class="flex flex-wrap items-center justify-between gap-4"><div><p class="text-xs font-semibold tracking-widest text-emerald-200">FARM JOURNAL</p><h2 class="mt-2 text-lg font-semibold">A little note today goes a long way.</h2><p class="mt-1 text-sm text-emerald-100/70">Capture observations, weather and field activity while they're fresh.</p></div><button data-create="journal" class="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-forest-800 transition hover:bg-emerald-50">Write an entry →</button></div></section>
  `;
  document.querySelector("#quick-add").addEventListener("click", openQuickAdd);
  content.querySelectorAll("[data-goto]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.goto)));
  content.querySelectorAll("[data-create]").forEach((button) => button.addEventListener("click", () => startCreate(button.dataset.create)));
}

function formatCell(key, value) {
  if (key === "blockId" && value) value = blocks.find((block) => block.id === value)?.name || "Archived block";
  if (key === "approvedAt") return `<span class="inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${value ? "bg-forest-50 text-forest-700" : "bg-amber-50 text-amber-700"}">${value ? "approved" : "awaiting approval"}</span>`;
  if (value === null || value === undefined || value === "") return `<span class="text-slate-300">—</span>`;
  if (key.toLowerCase().includes("date") || key === "expectedHarvest" || key === "plantingDate" || key === "observedAt") return escapeHtml(new Date(value).toLocaleDateString());
  if (["status", "priority", "species", "category", "healthStatus"].includes(key)) {
    const tone = ["URGENT", "HIGH", "SICK", "UNDER_TREATMENT"].includes(value) ? "bg-rose-50 text-rose-700" : ["COMPLETED", "APPROVED", "HEALTHY", "GROWING"].includes(value) ? "bg-forest-50 text-forest-700" : "bg-slate-100 text-slate-600";
    return `<span class="inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${tone}">${escapeHtml(value.toLowerCase().replaceAll("_", " "))}</span>`;
  }
  if (key === "amount") return `KES ${Number(value).toLocaleString()}`;
  if (key === "body" || key === "description") return `<span class="block max-w-xs truncate text-slate-500">${escapeHtml(value)}</span>`;
  return escapeHtml(value);
}

async function renderResource(page) {
  if (["farms", "blocks"].includes(page)) return renderStructureRecords(page);
  const resource = {
    ...config[page],
    columns: ["crops", "journal"].includes(page)
      ? [...config[page].columns, ["farmId", "Farm"], ["blockId", "Block / plot"]]
      : config[page].columns
  };
  const content = document.querySelector("#content");
  content.innerHTML = `<div class="flex min-h-64 items-center justify-center text-sm text-slate-400">Loading ${escapeHtml(resource.title.toLowerCase())}…</div>`;
  const [{ data }, farmRecords, blockRecords] = await Promise.all([
    api.get(`/${resource.endpoint}`), currentUser.role === "WORKER" ? Promise.resolve([]) : loadAll("/farms"),
    ["crops", "journal"].includes(page) ? loadAll("/blocks") : Promise.resolve([])
  ]);
  farms = farmRecords;
  blocks = blockRecords;
  const empty = data.length === 0;
  const canManage = resource.roles.includes(currentUser.role);
  content.innerHTML = `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p class="text-sm font-medium text-forest-600">FARM OPERATIONS</p><h1 class="mt-1 text-2xl font-semibold tracking-tight text-slate-900">${resource.title}</h1><p class="mt-2 text-sm text-slate-500">Manage your ${resource.title.toLowerCase()} and keep your team in sync.</p></div>${canManage ? `<button id="new-record" class="btn-primary">＋ <span class="hidden sm:inline">Add ${resource.singular}</span><span class="sm:hidden">Add</span></button>` : ""}</div>
    <div class="card overflow-hidden p-0"><div class="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 class="text-sm font-semibold">${resource.title}</h2><p class="mt-1 text-xs text-slate-400">${data.length} records</p></div><div class="hidden items-center gap-2 text-xs text-slate-400 sm:flex"><span class="h-2 w-2 rounded-full bg-forest-500"></span> Workspace data</div></div>
      ${empty ? `<div class="px-5 py-16 text-center"><div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-forest-50 text-xl text-forest-600">${page === "crops" ? "❋" : page === "tasks" ? "☑" : "+"}</div><p class="mt-4 text-sm font-semibold text-slate-800">No ${resource.title.toLowerCase()} yet</p><p class="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-400">Create your first ${resource.singular} and it will appear here.</p>${canManage ? `<button data-empty-create class="btn-primary mt-5">Add ${resource.singular}</button>` : ""}</div>` :
      `<div class="overflow-x-auto"><table class="w-full min-w-[720px] text-left"><thead class="bg-slate-50/70"><tr>${resource.columns.map(([, label]) => `<th class="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">${label}</th>`).join("")}<th class="w-24 px-3 py-3"></th></tr></thead><tbody class="divide-y divide-slate-100">${data.map((row) => `<tr class="group hover:bg-cream/60">${resource.columns.map(([key]) => `<td class="px-5 py-4 text-sm ${key === resource.columns[0][0] ? "font-semibold text-slate-800" : "text-slate-600"}">${formatCell(key, key === "farmId" ? farms.find((farm) => farm.id === row[key])?.name : row[key])}</td>`).join("")}<td class="px-3 py-4">${page === "tasks" && currentUser.role === "WORKER" && ["PENDING", "IN_PROGRESS"].includes(row.status) ? `<button data-task-status="${row.id}" data-next-status="${row.status === "PENDING" ? "IN_PROGRESS" : "COMPLETED"}" class="rounded-lg px-2 py-1 text-xs font-semibold text-forest-700 hover:bg-forest-50">${row.status === "PENDING" ? "Start" : "Submit"}</button>` : page === "expenses" && currentUser.role === "OWNER" && !row.approvedAt ? `<button data-approve="${row.id}" class="rounded-lg px-2 py-1 text-xs font-semibold text-forest-700 hover:bg-forest-50">Approve</button>` : canManage ? `<button data-delete="${row.id}" class="rounded-lg p-2 text-slate-300 opacity-100 transition hover:bg-red-50 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100" aria-label="Archive record">···</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`}
    </div>`;
  document.querySelector("#new-record")?.addEventListener("click", () => openRecordModal(page));
  content.querySelector("[data-empty-create]")?.addEventListener("click", () => openRecordModal(page));
  content.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm(`Archive this ${resource.singular}?`)) return;
    try {
      const response = await api.delete(`/${resource.endpoint}/${button.dataset.delete}`);
      showToast(response.message);
      await renderResource(page);
    } catch (error) { showToast(error.message, "error"); }
  }));
  content.querySelectorAll("[data-task-status]").forEach((button) => button.addEventListener("click", async () => {
    const nextStatus = button.dataset.nextStatus;
    const evidenceUrl = nextStatus === "COMPLETED" ? window.prompt("Evidence URL (optional):") : null;
    if (evidenceUrl === null && nextStatus === "COMPLETED") return;
    try {
      const response = await api.patch(`/tasks/${button.dataset.taskStatus}`, {
        status: nextStatus,
        ...(evidenceUrl?.trim() ? { evidenceUrl: evidenceUrl.trim() } : {})
      });
      showToast(response.message);
      await renderResource(page);
    } catch (error) { showToast(error.message, "error"); }
  }));
  content.querySelectorAll("[data-approve]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const response = await api.post(`/expenses/${button.dataset.approve}/approve`, {});
      showToast(response.message);
      await renderResource(page);
    } catch (error) { showToast(error.message, "error"); }
  }));
}

function gpsMarkup(record) {
  if (record.latitude == null || record.longitude == null) return '<span class="text-slate-400">Not set</span>';
  return `${escapeHtml(record.latitude)}, ${escapeHtml(record.longitude)}`;
}

async function renderStructure() {
  const { data } = await api.get("/organization");
  const canManage = ["OWNER", "MANAGER"].includes(currentUser.role);
  const content = document.querySelector("#content");
  content.innerHTML = `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p class="text-sm font-medium text-forest-600">ORGANIZATION / FARMS / BLOCKS</p><h1 class="mt-1 text-2xl font-semibold">${escapeHtml(data.name)}</h1><p class="mt-2 text-sm text-slate-500">${data.farms.length} farms · ${data.farms.reduce((count, farm) => count + farm.blocks.length, 0)} blocks / plots</p></div>${canManage ? '<button id="structure-add-farm" class="btn-primary">Add farm</button>' : ""}</div>
    ${currentUser.role === "OWNER" ? `<form id="organization-form" class="card mb-5 flex flex-wrap items-end gap-3"><label class="flex-1"><span class="label">Organization name</span><input class="field" name="name" value="${escapeHtml(data.name)}" required minlength="2" maxlength="120"></label><button class="btn-secondary" type="submit">Save workspace name</button></form>` : ""}
    <div class="space-y-5">${data.farms.length ? data.farms.map((farm) => `
      <section class="card"><div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-lg font-semibold">${escapeHtml(farm.name)}</h2><p class="mt-1 text-sm text-slate-500">${escapeHtml(farm.location || "Location not set")} · ${farm.acreage == null ? "Area not set" : `${escapeHtml(farm.acreage)} acres`}</p><p class="mt-2 text-xs text-slate-500">GPS: ${gpsMarkup(farm)}</p></div><button data-view-blocks="${farm.id}" class="btn-secondary">View blocks / plots</button></div>
      <div class="mt-4 space-y-2">${farm.blocks.length ? farm.blocks.map((block) => `<div class="rounded-xl border border-slate-100 p-3"><p class="text-sm font-semibold">${escapeHtml(block.name)}</p><p class="mt-1 text-xs text-slate-500">${block.acreage == null ? "Area not set" : `${escapeHtml(block.acreage)} acres`} · ${escapeHtml(block.currentUse || "Use not set")} · ${escapeHtml(block.soilType || "Soil not set")}</p><p class="mt-1 text-xs text-slate-500">GPS: ${gpsMarkup(block)}</p></div>`).join("") : '<p class="text-sm text-slate-400">No blocks / plots yet.</p>'}</div>
      ${canManage ? `<button data-add-block="${farm.id}" class="btn-primary mt-4">Add block / plot</button>` : ""}</section>`).join("") : '<section class="card text-sm text-slate-500">Add your first farm to begin building your farm hierarchy.</section>'}</div>`;
  content.querySelector("#structure-add-farm")?.addEventListener("click", () => openRecordModal("farms"));
  content.querySelectorAll("[data-view-blocks]").forEach((button) => button.addEventListener("click", () => {
    selectedFarmId = button.dataset.viewBlocks;
    navigate("blocks");
  }));
  content.querySelectorAll("[data-add-block]").forEach((button) => button.addEventListener("click", () => openRecordModal("blocks", { farmId: button.dataset.addBlock })));
  content.querySelector("#organization-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await api.patch("/organization", Object.fromEntries(new FormData(event.currentTarget)));
      if (response.queued) {
        showToast(response.message);
        return;
      }
      currentUser.organization.name = response.data.name;
      await renderApp();
      showToast(response.message);
    } catch (error) { showToast(error.message, "error"); }
  });
}

async function renderStructureRecords(page) {
  const resource = config[page];
  farms = await loadAll("/farms");
  if (!farms.some((farm) => farm.id === selectedFarmId)) selectedFarmId = "";
  const data = page === "farms" ? farms : await loadAll(`/blocks${selectedFarmId ? `?farmId=${selectedFarmId}` : ""}`);
  const canManage = resource.roles.includes(currentUser.role);
  const content = document.querySelector("#content");
  content.innerHTML = `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p class="text-sm font-medium text-forest-600">${escapeHtml(currentUser.organization.name)}</p><h1 class="mt-1 text-2xl font-semibold">${page === "blocks" ? "Blocks / plots" : "Farms"}</h1><p class="mt-2 text-sm text-slate-500">${data.length} records · Manage your farm hierarchy and locations.</p></div>${canManage ? `<button id="new-structure-record" class="btn-primary">Add ${resource.singular}</button>` : ""}</div>
    ${page === "blocks" ? `<label class="mb-5 block max-w-sm"><span class="label">Filter by farm</span><select id="structure-farm-filter" class="field"><option value="">All farms</option>${farms.map((farm) => `<option value="${farm.id}" ${selectedFarmId === farm.id ? "selected" : ""}>${escapeHtml(farm.name)}</option>`).join("")}</select></label>` : ""}
    <section class="card overflow-x-auto"><table class="w-full min-w-[700px] text-left"><thead><tr>${["Name", ...(page === "blocks" ? ["Farm"] : ["Location"]), "Acres", "GPS coordinates", "Actions"].map((title) => `<th class="px-3 py-3 text-xs">${title}</th>`).join("")}</tr></thead><tbody>${data.map((record) => `<tr><td class="px-3 py-3 text-sm font-semibold">${escapeHtml(record.name)}${page === "blocks" ? `<p class="mt-1 text-xs font-normal text-slate-500">${escapeHtml(record.currentUse || "")} ${escapeHtml(record.soilType || "")}</p>` : ""}</td><td class="px-3 py-3 text-sm">${escapeHtml(page === "blocks" ? record.farm.name : record.location || "")}</td><td class="px-3 py-3 text-sm">${record.acreage == null ? "Not set" : escapeHtml(record.acreage)}</td><td class="px-3 py-3 text-sm">${gpsMarkup(record)}</td><td class="px-3 py-3"><div class="flex gap-2">${page === "farms" ? `<button data-view-blocks="${record.id}" class="btn-secondary">Blocks</button>` : ""}${canManage ? `<button data-edit-structure="${record.id}" class="btn-secondary">Edit</button><button data-archive-structure="${record.id}" class="btn-secondary">Archive</button>` : ""}</div></td></tr>`).join("") || '<tr><td colspan="5" class="p-6 text-center text-sm text-slate-400">No records yet.</td></tr>'}</tbody></table></section>`;
  content.querySelector("#structure-farm-filter")?.addEventListener("change", async (event) => {
    selectedFarmId = event.target.value;
    await renderPage();
  });
  content.querySelector("#new-structure-record")?.addEventListener("click", () => openRecordModal(page, page === "blocks" ? { farmId: selectedFarmId } : {}));
  content.querySelectorAll("[data-view-blocks]").forEach((button) => button.addEventListener("click", () => {
    selectedFarmId = button.dataset.viewBlocks;
    navigate("blocks");
  }));
  content.querySelectorAll("[data-edit-structure]").forEach((button) => button.addEventListener("click", () => openRecordModal(page, data.find((record) => record.id === button.dataset.editStructure))));
  content.querySelectorAll("[data-archive-structure]").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm(`Archive this ${resource.singular}? Active child records must be archived or unlinked first.`)) return;
    try {
      const response = await api.delete(`/${page}/${button.dataset.archiveStructure}`);
      showToast(response.message);
      await renderPage();
    } catch (error) { showToast(error.message, "error"); }
  }));
}

async function renderSales() {
  const { data } = await api.get("/sales");
  const canManage = ["OWNER", "MANAGER"].includes(currentUser.role);
  const totals = data.reduce((sum, sale) => ({ revenue: sum.revenue + Number(sale.totalAmount), collected: sum.collected + sale.totalPaid, outstanding: sum.outstanding + sale.balance }), { revenue: 0, collected: 0, outstanding: 0 });
  document.querySelector("#content").innerHTML = `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p class="text-sm font-medium text-forest-600">SALES & COLLECTIONS</p><h1 class="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Sales & invoices</h1><p class="mt-2 text-sm text-slate-500">Record farm sales, issue invoices, and follow outstanding payments.</p></div>${canManage ? `<button id="new-sale" class="btn-primary">＋ Record a sale</button>` : ""}</div>
    <div class="mb-5 grid gap-3 sm:grid-cols-3">${metric("Invoiced", `KES ${totals.revenue.toLocaleString()}`, `${data.length} invoices`, "$", "bg-sky-50 text-sky-700")}${metric("Collected", `KES ${totals.collected.toLocaleString()}`, "Payments received", "✓", "bg-forest-50 text-forest-700")}${metric("Outstanding", `KES ${totals.outstanding.toLocaleString()}`, "Open invoice balances", "◷", "bg-amber-50 text-amber-700")}</div>
    <section class="card overflow-hidden p-0"><div class="overflow-x-auto"><table class="w-full min-w-[900px] text-left"><thead><tr>${["Invoice", "Product", "Buyer", "Date", "Total", "Paid", "Status", "Payment"].map((title) => `<th class="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">${title}</th>`).join("")}</tr></thead><tbody class="divide-y divide-slate-100">${data.length ? data.map((sale) => `<tr><td class="px-4 py-3 text-xs font-semibold text-forest-700">${escapeHtml(sale.invoiceNumber)}</td><td class="px-4 py-3"><p class="text-sm font-medium">${escapeHtml(sale.product)}</p><p class="text-xs text-slate-400">${Number(sale.quantity)} ${escapeHtml(sale.unit)}</p></td><td class="px-4 py-3 text-sm">${escapeHtml(sale.buyer?.name || "Walk-in buyer")}</td><td class="px-4 py-3 text-sm">${new Date(sale.soldAt).toLocaleDateString()}</td><td class="px-4 py-3 text-sm font-semibold">${escapeHtml(sale.currency)} ${Number(sale.totalAmount).toLocaleString()}</td><td class="px-4 py-3 text-sm">${Number(sale.totalPaid).toLocaleString()}</td><td class="px-4 py-3"><span class="rounded-full px-2 py-1 text-[10px] font-semibold ${sale.paymentStatus === "PAID" ? "bg-forest-50 text-forest-700" : sale.paymentStatus === "PARTIAL" ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700"}">${sale.paymentStatus.toLowerCase()}</span></td><td class="px-4 py-3">${canManage && sale.balance > 0 ? `<button data-payment="${sale.id}" data-balance="${sale.balance}" data-currency="${escapeHtml(sale.currency)}" class="rounded-lg px-2 py-1 text-xs font-semibold text-forest-700 hover:bg-forest-50">Record payment</button>` : "—"}</td></tr>`).join("") : `<tr><td colspan="8" class="px-5 py-16 text-center"><p class="text-sm font-semibold">No sales recorded yet</p><p class="mt-1 text-xs text-slate-400">Record a sale to create its invoice and track payments.</p></td></tr>`}</tbody></table></div></section>`;
  document.querySelector("#new-sale")?.addEventListener("click", openSaleModal);
  document.querySelectorAll("[data-payment]").forEach((button) => button.addEventListener("click", () => openPaymentModal(button.dataset.payment, Number(button.dataset.balance), button.dataset.currency)));
}

async function openSaleModal() {
  const [farmResponse, buyerResponse] = await Promise.all([
    api.get("/farms").catch(() => ({ data: [] })),
    api.get("/sales/buyers")
  ]);
  farms = farmResponse.data;
  const buyers = buyerResponse.data;
  const root = document.querySelector("#modal-root");
  root.innerHTML = `<div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-5"><div class="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-6 sm:rounded-2xl"><div class="flex items-center justify-between"><div><p class="text-xs font-semibold uppercase tracking-wider text-forest-600">SALES</p><h2 class="mt-1 text-lg font-semibold">Record a sale</h2></div><button data-close class="rounded-lg p-2 text-slate-400" aria-label="Close">✕</button></div><form id="sale-form" class="mt-5 grid gap-4 sm:grid-cols-2"><label class="block sm:col-span-2"><span class="label">Product / produce</span><input class="field" name="product" required minlength="2" maxlength="160" placeholder="e.g. Fresh eggs"></label><label class="block"><span class="label">Quantity</span><input class="field" name="quantity" type="number" required min="0.001" step="any"></label><label class="block"><span class="label">Unit</span><input class="field" name="unit" required maxlength="30" placeholder="trays, kg, heads"></label><label class="block"><span class="label">Unit price (KES)</span><input class="field" name="unitPrice" type="number" required min="0.01" step="0.01"></label><label class="block"><span class="label">Farm</span><select class="field" name="farmId"><option value="">Not specified</option>${farms.map((farm) => `<option value="${farm.id}">${escapeHtml(farm.name)}</option>`).join("")}</select></label><label class="block sm:col-span-2"><span class="label">Buyer</span><select id="sale-buyer" class="field" name="buyerId"><option value="">Add a new buyer</option>${buyers.map((buyer) => `<option value="${buyer.id}">${escapeHtml(buyer.name)}${buyer.phone ? ` · ${escapeHtml(buyer.phone)}` : ""}</option>`).join("")}</select></label><div id="new-buyer-fields" class="grid gap-4 sm:col-span-2 sm:grid-cols-2"><label class="block"><span class="label">New buyer name</span><input class="field" name="buyerName" required minlength="2" maxlength="120"></label><label class="block"><span class="label">Buyer phone (optional)</span><input class="field" name="buyerPhone" maxlength="40"></label><label class="block sm:col-span-2"><span class="label">Buyer email (optional)</span><input class="field" name="buyerEmail" type="email"></label></div><label class="block"><span class="label">Invoice due date</span><input class="field" name="dueDate" type="date"></label><label class="block sm:col-span-2"><span class="label">Notes</span><textarea class="field" name="notes" rows="2"></textarea></label><div class="flex gap-3 sm:col-span-2"><button type="button" data-close class="btn-secondary flex-1">Cancel</button><button type="submit" class="btn-primary flex-1">Create invoice</button></div></form></div></div>`;
  root.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => { root.innerHTML = ""; }));
  const buyerSelect = root.querySelector("#sale-buyer");
  const buyerFields = root.querySelector("#new-buyer-fields");
  const buyerName = root.querySelector("[name=buyerName]");
  buyerSelect.addEventListener("change", () => {
    const creating = !buyerSelect.value;
    buyerFields.classList.toggle("hidden", !creating);
    buyerName.required = creating;
  });
  root.querySelector("#sale-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const payload = {
      product: values.product,
      quantity: Number(values.quantity),
      unit: values.unit,
      unitPrice: Number(values.unitPrice),
      ...(values.buyerId
        ? { buyerId: values.buyerId }
        : { buyer: { name: values.buyerName, ...(values.buyerPhone ? { phone: values.buyerPhone } : {}), ...(values.buyerEmail ? { email: values.buyerEmail } : {}) } }),
      ...(values.farmId ? { farmId: values.farmId } : {}),
      ...(values.dueDate ? { dueDate: values.dueDate } : {}),
      ...(values.notes ? { notes: values.notes } : {})
    };
    try {
      const response = await api.post("/sales", payload);
      root.innerHTML = "";
      showToast(response.message);
      await renderSales();
    } catch (error) { showToast(error.message, "error"); }
  });
}

function openPaymentModal(saleId, balance, currency) {
  const root = document.querySelector("#modal-root");
  root.innerHTML = `<div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-5"><div class="w-full max-w-md rounded-t-3xl bg-white p-6 sm:rounded-2xl"><div class="flex items-center justify-between"><div><p class="text-xs font-semibold uppercase tracking-wider text-forest-600">INVOICE PAYMENT</p><h2 class="mt-1 text-lg font-semibold">Record payment</h2></div><button data-close class="rounded-lg p-2 text-slate-400" aria-label="Close">✕</button></div><p class="mt-2 text-sm text-slate-500">Outstanding: ${escapeHtml(currency)} ${balance.toLocaleString()}</p><form id="payment-form" class="mt-5 space-y-4"><label class="block"><span class="label">Amount</span><input class="field" name="amount" type="number" min="0.01" max="${balance}" step="0.01" required></label><label class="block"><span class="label">Payment method</span><select class="field" name="method"><option value="MPESA">M-Pesa</option><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CHEQUE">Cheque</option><option value="OTHER">Other</option></select></label><label class="block"><span class="label">Transaction reference</span><input class="field" name="reference" maxlength="120"></label><div class="flex gap-3"><button type="button" data-close class="btn-secondary flex-1">Cancel</button><button type="submit" class="btn-primary flex-1">Save payment</button></div></form></div></div>`;
  root.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => { root.innerHTML = ""; }));
  root.querySelector("#payment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const payload = { amount: Number(values.amount), method: values.method, ...(values.reference ? { reference: values.reference } : {}) };
    try {
      const response = await api.post(`/sales/${saleId}/payments`, payload);
      root.innerHTML = "";
      showToast(response.message);
      await renderSales();
    } catch (error) { showToast(error.message, "error"); }
  });
}

async function renderDocuments() {
  const { data } = await api.get("/documents");
  const farmResponse = await api.get("/farms").catch(() => ({ data: [] }));
  farms = farmResponse.data;
  const mayUpload = true;
  const categories = currentUser.role === "WORKER" ? ["FARM_PHOTO"] : ["SOIL_REPORT", "WATER_ANALYSIS", "PATHOLOGY_REPORT", "FARM_LICENSE", "PURCHASE_RECEIPT", "AGRONOMIST_REPORT", "FARM_PHOTO", "OTHER"];
  document.querySelector("#content").innerHTML = `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p class="text-sm font-medium text-forest-600">FARM RECORDS</p><h1 class="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Documents</h1><p class="mt-2 text-sm text-slate-500">Private workspace files for reports, receipts, and farm photos.</p></div>${mayUpload ? `<button id="upload-document" class="btn-primary">↑ Upload document</button>` : ""}</div>
    <section class="card overflow-hidden p-0"><div class="overflow-x-auto"><table class="w-full min-w-[700px] text-left"><thead><tr>${["File", "Category", "Farm", "Size", "Uploaded", "Actions"].map((title) => `<th class="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">${title}</th>`).join("")}</tr></thead><tbody class="divide-y divide-slate-100">${data.length ? data.map((document) => `<tr><td class="px-4 py-3"><p class="max-w-xs truncate text-sm font-semibold">${escapeHtml(document.originalName)}</p><p class="mt-1 truncate text-xs text-slate-400">${escapeHtml(document.description || document.uploader?.name || "")}</p></td><td class="px-4 py-3 text-xs capitalize">${escapeHtml(document.category.toLowerCase().replaceAll("_", " "))}</td><td class="px-4 py-3 text-sm">${escapeHtml(document.farm?.name || "—")}</td><td class="px-4 py-3 text-sm">${(document.sizeBytes / 1024 / 1024).toFixed(2)} MB</td><td class="px-4 py-3 text-sm">${new Date(document.createdAt).toLocaleDateString()}</td><td class="px-4 py-3"><div class="flex gap-2"><a class="text-xs font-semibold" href="/api/v1/documents/${document.id}/download">Download</a>${currentUser.role !== "WORKER" ? `<button data-archive-document="${document.id}" class="text-xs font-semibold text-red-600">Archive</button>` : ""}</div></td></tr>`).join("") : `<tr><td colspan="6" class="px-5 py-16 text-center"><p class="text-sm font-semibold">No documents uploaded yet</p><p class="mt-1 text-xs text-slate-400">Add soil, water, pathology reports, receipts, or farm photos.</p></td></tr>`}</tbody></table></div></section>
    <p class="mt-3 text-xs text-slate-400">Accepted files: PDF, JPEG, PNG, WebP. Maximum size: 10 MB. Files are private to this farm workspace.</p>`;
  document.querySelector("#upload-document")?.addEventListener("click", () => openDocumentModal(categories));
  document.querySelectorAll("[data-archive-document]").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("Archive this document?")) return;
    try {
      const response = await api.delete(`/documents/${button.dataset.archiveDocument}`);
      showToast(response.message);
      await renderDocuments();
    } catch (error) { showToast(error.message, "error"); }
  }));
}

async function openDocumentModal(categories) {
  const response = await api.get("/farms").catch(() => ({ data: [] }));
  farms = response.data;
  const root = document.querySelector("#modal-root");
  root.innerHTML = `<div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-5"><div class="w-full max-w-lg rounded-t-3xl bg-white p-6 sm:rounded-2xl"><div class="flex items-center justify-between"><div><p class="text-xs font-semibold uppercase tracking-wider text-forest-600">FARM RECORDS</p><h2 class="mt-1 text-lg font-semibold">Upload document</h2></div><button data-close class="rounded-lg p-2 text-slate-400" aria-label="Close">✕</button></div><form id="document-form" class="mt-5 space-y-4"><label class="block"><span class="label">File (PDF, JPEG, PNG, WebP · max 10 MB)</span><input class="field" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" required></label><label class="block"><span class="label">Category</span><select class="field" name="category" required>${categories.map((category) => `<option value="${category}">${category.toLowerCase().replaceAll("_", " ")}</option>`).join("")}</select></label><label class="block"><span class="label">Farm (optional)</span><select class="field" name="farmId"><option value="">Not specified</option>${farms.map((farm) => `<option value="${farm.id}">${escapeHtml(farm.name)}</option>`).join("")}</select></label><label class="block"><span class="label">Description (optional)</span><input class="field" name="description" maxlength="500"></label><div class="flex gap-3"><button type="button" data-close class="btn-secondary flex-1">Cancel</button><button type="submit" class="btn-primary flex-1">Upload</button></div></form></div></div>`;
  root.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => { root.innerHTML = ""; }));
  root.querySelector("#document-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    if (!formData.get("farmId")) formData.delete("farmId");
    if (!formData.get("description")) formData.delete("description");
    const submit = event.currentTarget.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      const response = await api.upload("/documents", formData);
      root.innerHTML = "";
      showToast(response.message);
      await renderDocuments();
    } catch (error) {
      submit.disabled = false;
      showToast(error.message, "error");
    }
  });
}

async function startCreate(page) {
  if (page === "journal") return openDailyReport();
  if (!allowedPages().includes(page)) {
    showToast("You do not have access to this page.", "error");
    return;
  }
  if (["expenses", "sales", "inventory"].includes(page) && !["OWNER", "MANAGER"].includes(currentUser.role)) {
    showToast("You do not have permission to create this record.", "error");
    return;
  }
  if (page === "inventory") {
    const result = await api.get("/farms").catch(() => ({ data: [] }));
    farms = result.data;
    openStockItemModal();
  } else if (page === "sales") openSaleModal();
  else if (page === "documents") {
    const categories = currentUser.role === "WORKER"
      ? ["FARM_PHOTO"]
      : ["SOIL_REPORT", "WATER_ANALYSIS", "PATHOLOGY_REPORT", "FARM_LICENSE", "PURCHASE_RECEIPT", "AGRONOMIST_REPORT", "FARM_PHOTO", "OTHER"];
    openDocumentModal(categories);
  } else if (page === "crops") await openCropModal();
  else if (page === "livestock") await openLivestockModal();
  else if (page === "tasks") await openTaskModal();
  else openRecordModal(page);
}

function fieldMarkup([key, label, type, required = false, options = []], values = {}) {
  const value = values[key] ?? "";
  const common = `name="${key}" id="field-${key}" class="field" ${required ? "required" : ""}`;
  if (type === "textarea") return `<label class="block sm:col-span-2"><span class="label">${label}</span><textarea ${common} rows="3">${escapeHtml(value)}</textarea></label>`;
  if (type === "select") return `<label class="block"><span class="label">${label}</span><select ${common}><option value="">Select ${label.toLowerCase()}</option>${options.map((item) => `<option value="${item}" ${value === item ? "selected" : ""}>${escapeHtml(item.toLowerCase().replaceAll("_", " "))}</option>`).join("")}</select></label>`;
  if (type === "farm") return `<label class="block"><span class="label">${label}</span><select ${common} ${required ? "required" : ""}><option value="">Select a farm</option>${farms.map((farm) => `<option value="${farm.id}" ${value === farm.id ? "selected" : ""}>${escapeHtml(farm.name)}</option>`).join("")}</select></label>`;
  if (type === "team") return `<label class="block"><span class="label">${label}</span><select ${common}><option value="">Unassigned</option>${teamMembers.map((member) => `<option value="${member.user.id}" ${value === member.user.id ? "selected" : ""}>${escapeHtml(member.user.name)} · ${escapeHtml(member.role.toLowerCase())}</option>`).join("")}</select></label>`;
  if (type === "block") return `<label class="block"><span class="label">${label}</span><select ${common}><option value="">No block / plot</option>${blocks.filter((block) => block.farmId === values.farmId).map((block) => `<option value="${block.id}" ${value === block.id ? "selected" : ""}>${escapeHtml(block.name)}</option>`).join("")}</select></label>`;
  const bounds = key === "latitude" ? 'min="-90" max="90"' : key === "longitude" ? 'min="-180" max="180"' : 'min="0"';
  return `<label class="block"><span class="label">${label}</span><input ${common} type="${type}" value="${escapeHtml(value)}" ${type === "number" ? `step="any" ${bounds}` : ""}></label>`;
}

async function openRecordModal(page, values = {}) {
  if (page === "journal") return openDailyReport();
  if (page === "tasks") return openTaskModal(values);
  try {
  const resource = config[page];
  const editing = Boolean(values.id);
  if (resource.fields.some(([, , type]) => type === "farm")) {
    farms = await loadAll("/farms");
  }
  if (["crops", "journal"].includes(page)) blocks = await loadAll("/blocks");
  if (page === "tasks") teamMembers = (await api.get("/team")).data;
  const root = document.querySelector("#modal-root");
  const fields = [...resource.fields];
  if (["crops", "journal"].includes(page)) fields.splice(fields.findIndex(([key]) => key === "farmId") + 1, 0, ["blockId", "Block / plot", "block"]);
  root.innerHTML = `<div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"><div class="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-7"><div class="flex items-start justify-between"><div><p class="text-xs font-semibold uppercase tracking-wider text-forest-600">${editing ? "EDIT RECORD" : "NEW RECORD"}</p><h2 class="mt-1 text-xl font-semibold text-slate-900">${editing ? "Edit" : "Add"} ${resource.singular}</h2></div><button data-close class="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button></div><form id="record-form" class="mt-6 grid gap-4 sm:grid-cols-2">${fields.map((field) => fieldMarkup(field, values)).join("")}${["farms", "blocks"].includes(page) ? '<div class="sm:col-span-2"><button type="button" id="capture-gps" class="btn-secondary">Use current GPS location</button><p class="mt-2 text-xs text-slate-500">Provide both latitude and longitude, or leave both blank. Location access requires HTTPS or localhost.</p></div>' : ""}<div class="mt-2 flex gap-3 sm:col-span-2"><button type="button" data-close class="btn-secondary flex-1">Cancel</button><button type="submit" class="btn-primary flex-1">Save ${resource.singular}</button></div></form></div></div>`;
  if (page === "blocks" && editing) root.querySelector("#field-farmId").disabled = true;
  root.querySelector("#field-farmId")?.addEventListener("change", (event) => {
    const select = root.querySelector("#field-blockId");
    if (select) select.innerHTML = `<option value="">No block / plot</option>${blocks.filter((block) => block.farmId === event.target.value).map((block) => `<option value="${block.id}">${escapeHtml(block.name)}</option>`).join("")}`;
  });
  root.querySelector("#capture-gps")?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      showToast("Your browser does not support location access.", "error");
      return;
    }
    const button = root.querySelector("#capture-gps");
    button.disabled = true;
    navigator.geolocation.getCurrentPosition((position) => {
      if (!root.querySelector("#field-latitude")) return;
      root.querySelector("#field-latitude").value = position.coords.latitude;
      root.querySelector("#field-longitude").value = position.coords.longitude;
      button.disabled = false;
      showToast("GPS coordinates captured. Save the record to keep them.");
    }, (error) => {
      button.disabled = false;
      showToast(`Could not capture GPS location: ${error.message}`, "error");
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
  root.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => { root.innerHTML = ""; }));
  root.querySelector("#record-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {};
    for (const [key, value] of formData.entries()) {
      if (value === "") {
        if (editing) payload[key] = null;
        continue;
      }
      const field = fields.find(([name]) => name === key);
      payload[key] = field[2] === "number" ? Number(value) : value;
    }
    const submit = event.currentTarget.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      const response = editing
        ? await api.patch(`/${resource.endpoint}/${values.id}`, payload)
        : await api.post(`/${resource.endpoint}`, payload);
      root.innerHTML = "";
      showToast(response.message);
      await renderPage();
    } catch (error) { submit.disabled = false; showToast(error.message, "error"); }
  });
  } catch (error) { showToast(error.message, "error"); }
}

function openQuickAdd() {
  if (currentUser.role === "WORKER") return openDailyReport();
  const root = document.querySelector("#modal-root");
  root.innerHTML = `<div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-5"><div class="w-full max-w-md rounded-t-3xl bg-white p-6 sm:rounded-2xl"><div class="flex items-center justify-between"><h2 class="text-lg font-semibold">Quick add</h2><button data-close class="rounded-lg p-2 text-slate-400" aria-label="Close">✕</button></div><p class="mt-1 text-sm text-slate-500">What would you like to add?</p><div class="mt-5 grid grid-cols-2 gap-3">${[["farms", "⌂", "Farm"], ["crops", "❋", "Crop cycle"], ["livestock", "♧", "Livestock"], ["tasks", "☑", "Task"], ["journal", "▤", "Journal entry"], ["expenses", "↗", "Expense"], ["inventory", "▤", "Inventory item"], ["sales", "$", "Sale"], ["documents", "▧", "Document"]].map(([page, symbol, title]) => `<button data-quick="${page}" class="flex items-center gap-3 rounded-xl border border-slate-100 p-4 text-left transition hover:border-forest-200 hover:bg-forest-50">${icon(symbol, "text-forest-700")}<span class="text-sm font-medium">${title}</span></button>`).join("")}</div></div></div>`;
  root.querySelector("[data-close]").addEventListener("click", () => { root.innerHTML = ""; });
  root.querySelectorAll("[data-quick]").forEach((button) => {
    const page = button.dataset.quick;
    if (config[page]?.roles && !config[page].roles.includes(currentUser.role)) button.remove();
    else if (["expenses", "sales", "inventory"].includes(page) && !["OWNER", "MANAGER"].includes(currentUser.role)) button.remove();
    else button.addEventListener("click", () => { root.innerHTML = ""; startCreate(page); });
  });
}

async function renderPage() {
  const content = document.querySelector("#content");
  try {
    if (!allowedPages().includes(currentPage)) throw new Error("You do not have access to this page.");
    if (currentPage === "dashboard") await renderDashboard();
    else if (currentPage === "structure") await renderStructure();
    else if (currentPage === "inventory") await renderStockInventory(location.hash.split("/")[1]);
    else if (currentPage === "sales") await renderSales();
    else if (currentPage === "documents") await renderDocuments();
    else if (currentPage === "clients") await renderClients();
    else if (currentPage === "account") renderAccount();
    else if (currentPage === "crops") await renderCrops(location.hash.split("/")[1]);
    else if (currentPage === "livestock") await renderLivestock(location.hash.split("/")[1]);
    else if (currentPage === "tasks") await renderTasks(location.hash.split("/")[1]);
    else if (currentPage === "team") await renderWorkspaceTeam();
    else if (currentPage === "journal") await renderReports(location.hash.split("/")[1]);
    else if (config[currentPage]) await renderResource(currentPage);
    makeTablesResponsive();
    await refreshNotifications();
  } catch (error) {
    content.innerHTML = `<div class="card mx-auto mt-10 max-w-lg p-8 text-center"><div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-xl text-amber-700">!</div><h2 class="mt-4 font-semibold">We couldn't load this page</h2><p class="mt-2 text-sm text-slate-500">${escapeHtml(error.message)}</p><button id="retry" class="btn-secondary mt-5">Try again</button></div>`;
    document.querySelector("#retry").addEventListener("click", renderPage);
  }

}

function makeTablesResponsive() {
  document.querySelectorAll("#content table, #modal-root table").forEach((table) => {
    table.classList.add("responsive-table");
    const headers = [...table.querySelectorAll("thead th")].map((header) => header.textContent.trim());
    table.querySelectorAll("tbody tr").forEach((row) => {
      [...row.cells].forEach((cell, index) => {
        if (cell.colSpan === 1) cell.dataset.label = headers[index] || "Actions";
      });
    });
    table.parentElement.classList.add("responsive-records");
  });
}

function updateConnectivity() {
  const indicator = document.querySelector("#sync-indicator");
  if (!indicator) return;
  indicator.textContent = navigator.onLine ? "" : "Offline · changes saved here";
  indicator.classList.toggle("hidden", navigator.onLine);
  document.querySelector("#connection-status").textContent = navigator.onLine ? "● Connected" : "● Offline";
  document.querySelector("#connection-status").className = `mt-2 px-2 text-xs ${navigator.onLine ? "text-emerald-200" : "text-amber-200"}`;
}

let connectivityInitialized = false;
function setupConnectivity() {
  if (!connectivityInitialized) {
    window.addEventListener("online", async () => {
      updateConnectivity();
      if (!currentUser) return;
      try {
        const synced = await syncOutbox({ organizationId: currentUser.organization.id, userId: currentUser.user.id });
        if (synced) showToast(`${synced} offline ${synced === 1 ? "change" : "changes"} synced`);
        await renderPage();
      } catch (error) { showToast(error.message, "error"); }
    });
    window.addEventListener("offline", updateConnectivity);
    connectivityInitialized = true;
  }
  offlineStore.pending().then((pending) => {
    const indicator = document.querySelector("#sync-indicator");
    if (indicator && navigator.onLine && pending.length) {
      indicator.textContent = `${pending.length} waiting to sync`;
      indicator.classList.remove("hidden");
    }
  }).catch((error) => console.error("Offline storage unavailable", error));
}

async function start() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch((error) => console.error("Service worker registration failed", error));
  if (location.hash.startsWith("#setup/")) {
    renderSetup(location.hash.slice(7));
    return;
  }
  try {
    const { data } = await api.get("/auth/me");
    currentUser = data;
    const requestedPage = location.hash.slice(1).split("/")[0];
    currentPage = allowedPages().includes(requestedPage) ? requestedPage : allowedPages()[0];
    setOfflineIdentity({ organizationId: currentUser.organization.id, userId: currentUser.user.id, role: currentUser.role });
    await renderApp();
  } catch (error) {
    if (error.message.includes("offline")) {
      renderAuth();
      showToast("Reconnect to sign in and access your workspace.", "error");
    } else renderAuth();
  }
}

configureV03({
  escapeHtml, showToast, loadAll, navigate, getUser: () => currentUser, reload: renderPage,
  signedOut: () => { currentUser = null; mobileOpen = false; setOfflineIdentity(null); renderAuth(); }
});
configureReports({ escapeHtml, showToast, loadAll, getUser: () => currentUser });
configureLivestock({ escapeHtml, showToast, loadAll, navigate });
configureTasks({ escapeHtml, showToast, loadAll, navigate, getUser: () => currentUser, reload: renderPage });
configureNotifications({ escapeHtml, showToast, loadAll, getUser: () => currentUser, reload: renderPage });
configureInventory({ escapeHtml, showToast, loadAll, getUser: () => currentUser, reload: renderPage });
window.addEventListener("hashchange", async () => {
  if (location.hash.startsWith("#setup/")) {
    currentUser = null;
    setOfflineIdentity(null);
    renderSetup(location.hash.slice(7));
    return;
  }
  if (!currentUser) return;
  const page = location.hash.slice(1).split("/")[0];
  if (!allowedPages().includes(page)) {
    showToast("You do not have access to this page.", "error");
    history.replaceState(null, "", `#${currentPage}`);
    return;
  }
  currentPage = page;
  mobileOpen = false;
  await renderApp();
});
start();
