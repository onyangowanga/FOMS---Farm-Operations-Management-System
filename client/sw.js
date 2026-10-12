const CACHE_NAME = "foms-shell-v0.6.0";
const APP_SHELL = ["/", "/styles.css?v=0.6.0", "/js/app.js?v=0.6.0", "/js/api.js?v=0.6.0", "/js/v03.js?v=0.6.0", "/js/reports.js?v=0.6.0", "/js/livestock.js?v=0.6.0", "/js/tasks.js?v=0.6.0", "/js/notifications.js?v=0.6.0", "/js/crop-schedule.js?v=0.6.0", "/js/offline.js", "/favicon/favicon.ico?v=0.6.0", "/favicon/favicon-16x16.png?v=0.6.0", "/favicon/favicon-32x32.png?v=0.6.0", "/favicon/apple-touch-icon.png?v=0.6.0", "/favicon/android-chrome-192x192.png?v=0.6.0", "/favicon/android-chrome-512x512.png?v=0.6.0", "/favicon/site.webmanifest?v=0.6.0"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(async () => (await caches.match(event.request)) || Response.error())
  );
});
