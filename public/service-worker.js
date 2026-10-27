self.__APP_CPE_SW_VERSION__ = "20261027-calendar-swipe-66";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({
      type: "APP_CPE_FORCE_RELOAD",
      version: self.__APP_CPE_SW_VERSION__
    }));
  })());
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || event.request.method !== "GET") return;
  event.respondWith(fetch(event.request, { cache: "no-store" }));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_VERSION") {
    event.source?.postMessage({ type: "SW_VERSION", version: self.__APP_CPE_SW_VERSION__ });
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* A notification without payload still opens the activity page. */ }
  const target = payload.targetTab === "sueldometro" ? "sueldometro" : "novedades";
  event.waitUntil(self.registration.showNotification(payload.title || "App CPE", {
    body: payload.body || "Tienes una novedad.",
    icon: `${self.registration.scope}logo.jpg`,
    tag: payload.notificationId || undefined,
    data: { url: `${self.registration.scope}#/${target}` }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || `${self.registration.scope}#/novedades`;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows.find((item) => item.url.startsWith(self.registration.scope));
    if (client) { await client.focus(); client.navigate(url); }
    else await self.clients.openWindow(url);
  })());
});
