self.__APP_CPE_SW_VERSION__ = "20261030-contracting-doors-option-a-73";

const ACTIVITY_TAG = "app-cpe-activity";
const ACTIVITY_BUNDLE_WINDOW_MS = 90_000;
let pendingNotifications = Promise.resolve();

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
  const notificationId = String(payload.notificationId || "");
  const job = pendingNotifications.catch(() => {}).then(async () => {
    const shown = typeof self.registration.getNotifications === "function"
      ? await self.registration.getNotifications({ tag: ACTIVITY_TAG }) : [];
    const previous = shown[0];
    const recent = previous?.data?.updatedAt && Date.now() - previous.data.updatedAt < ACTIVITY_BUNDLE_WINDOW_MS;
    const ids = recent ? [...(previous.data.ids || [])] : [];
    if (/^[0-9a-f-]{36}$/i.test(notificationId) && !ids.includes(notificationId) && ids.length < 20) ids.push(notificationId);
    const count = recent ? (previous.data.count || 1) + (notificationId && previous.data.ids?.includes(notificationId) ? 0 : 1) : 1;
    const target = count > 1
      ? `novedades?source=push&ids=${ids.join(",")}`
      : /^[0-9a-f-]{36}$/i.test(notificationId)
        ? `novedades/${notificationId}?source=push`
        : payload.targetTab === "sueldometro" ? "sueldometro" : "novedades";
    await self.registration.showNotification(
      count > 1 ? `${count} novedades en App CPE` : payload.title || "App CPE",
      {
        body: count > 1 ? "Abre Novedades para ver todos los avisos." : payload.body || "Tienes una novedad.",
        icon: `${self.registration.scope}logo.jpg`,
        tag: ACTIVITY_TAG,
        renotify: false,
        data: { url: `${self.registration.scope}#/${target}`, ids, count, updatedAt: Date.now() }
      }
    );
  });
  pendingNotifications = job;
  event.waitUntil(job);
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
