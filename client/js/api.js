import { offlineStore } from "./offline.js";

let offlineIdentity = "anonymous";
let offlineCacheScope = "anonymous";
export function setOfflineIdentity(identity) {
  offlineIdentity = identity ? `${identity.organizationId}:${identity.userId}` : "anonymous";
  offlineCacheScope = identity ? `${offlineIdentity}:${identity.role}` : "anonymous";
}

async function apiRequest(path, options = {}, download = false) {
  const method = options.method || "GET";
  if (!navigator.onLine && method === "GET") {
    if (/^\/(auth|admin|team|notifications|finance|expenses|sales|reporting)(\/|\?|$)/.test(path)) throw new Error("Reconnect to verify your sign-in, reports, financial records, accounts and notifications.");
    const cached = await offlineStore.get(`${offlineCacheScope}:${path}`);
    if (cached !== undefined) return cached;
    throw new Error("You are offline and this information has not been saved on this device yet.");
  }
  let response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      credentials: "same-origin",
      headers: {
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...options.headers
      }
    });
  } catch (error) {
    if (method !== "GET" && !path.startsWith("/auth/")) {
      if (options.queueOffline === false || /^\/(admin|team|livestock|tasks|notifications|inventory|expenses|sales|finance)(\/|\?|$)/.test(path) || /^\/journal\/[^/?]+\/follow-ups(?:\?|$)/.test(path)) throw new Error("You are offline. Reconnect before managing accounts, livestock, tasks, inventory, finance, notifications, incident follow-ups or uploading files.");
      await offlineStore.enqueue({ path, method, body: options.body, identity: offlineIdentity });
      return { success: true, queued: true, message: "Saved on this device. It will sync when you are back online." };
    }
    throw error;
  }
  if (response.status === 401 && !path.startsWith("/auth/")) {
    const refreshed = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "same-origin" });
    if (refreshed.ok) return apiRequest(path, options, download);
  }
  const body = response.ok && download ? await response.blob() : await response.json();
  if (!response.ok) {
    const validation = Array.isArray(body.errors)
      ? body.errors.map((issue) => `${issue.field ? `${issue.field}: ` : ""}${issue.message}`).join("; ")
      : "";
    throw new Error(validation || body.message || "The request could not be completed");
  }
  if (method === "GET" && !download && !/^\/(auth|admin|team|notifications|finance|expenses|sales|reporting)(\/|\?|$)/.test(path)) await offlineStore.put(`${offlineCacheScope}:${path}`, body);
  return body;
}

export async function syncOutbox(identity) {
  if (!navigator.onLine) return 0;
  let synced = 0;
  for (const operation of await offlineStore.pending()) {
    if (operation.identity !== `${identity.organizationId}:${identity.userId}`) continue;
    if (/^\/(expenses|sales|finance)(\/|\?|$)/.test(operation.path)) throw new Error("A financial change saved by an older app is awaiting review. It has not been replayed automatically; contact your workspace administrator before recording it again.");
    const response = await fetch(`/api/v1${operation.path}`, {
      method: operation.method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: operation.body
    });
    if (!response.ok) {
      if (response.status === 401) break;
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "An offline change could not be synced");
    }
    await offlineStore.remove(operation.id);
    synced++;
  }
  return synced;
}

export const api = {
  get: (path) => apiRequest(path),
  download: (path) => apiRequest(path, {}, true),
  post: (path, body) => apiRequest(path, { method: "POST", body: JSON.stringify(body) }),
  upload: (path, body) => apiRequest(path, { method: "POST", body, queueOffline: false }),
  put: (path, body) => apiRequest(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: (path, body) => apiRequest(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (path) => apiRequest(path, { method: "DELETE" })
};
