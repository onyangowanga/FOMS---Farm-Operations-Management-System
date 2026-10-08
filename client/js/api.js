import { offlineStore } from "./offline.js";

let offlineIdentity = "anonymous";
export function setOfflineIdentity(identity) {
  offlineIdentity = identity ? `${identity.organizationId}:${identity.userId}` : "anonymous";
}

async function apiRequest(path, options = {}) {
  const method = options.method || "GET";
  if (!navigator.onLine && method === "GET") {
    if (path.startsWith("/auth/")) throw new Error("Reconnect to verify your sign-in before continuing.");
    const cached = await offlineStore.get(`${offlineIdentity}:${path}`);
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
      if (options.queueOffline === false) throw new Error("You are offline. Reconnect before uploading a file.");
      await offlineStore.enqueue({ path, method, body: options.body, identity: offlineIdentity });
      return { success: true, queued: true, message: "Saved on this device. It will sync when you are back online." };
    }
    throw error;
  }
  if (response.status === 401 && !path.startsWith("/auth/")) {
    const refreshed = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "same-origin" });
    if (refreshed.ok) return apiRequest(path, options);
  }
  const body = await response.json();
  if (!response.ok) {
    const validation = Array.isArray(body.errors)
      ? body.errors.map((issue) => `${issue.field ? `${issue.field}: ` : ""}${issue.message}`).join("; ")
      : "";
    throw new Error(validation || body.message || "The request could not be completed");
  }
  if (method === "GET" && !path.startsWith("/auth/")) await offlineStore.put(`${offlineIdentity}:${path}`, body);
  return body;
}

export async function syncOutbox(identity) {
  if (!navigator.onLine) return 0;
  let synced = 0;
  for (const operation of await offlineStore.pending()) {
    if (operation.identity !== `${identity.organizationId}:${identity.userId}`) continue;
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
  post: (path, body) => apiRequest(path, { method: "POST", body: JSON.stringify(body) }),
  upload: (path, body) => apiRequest(path, { method: "POST", body, queueOffline: false }),
  patch: (path, body) => apiRequest(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (path) => apiRequest(path, { method: "DELETE" })
};
