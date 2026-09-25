import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { createVersionMonitor } from "./versionMonitor.js";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const versionMonitor = createVersionMonitor({
  currentVersion: __APP_CPE_BUILD_ID__,
  baseUrl: import.meta.env.BASE_URL
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      void versionMonitor.check();
    });
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "APP_CPE_FORCE_RELOAD") void versionMonitor.check();
    });

    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js?v=20260925-auto-update-bootstrap`, {
      updateViaCache: "none"
    }).then((registration) => {
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
      registration.update().catch(() => {});
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") registration.update().catch(() => {});
      });
      window.setInterval(() => registration.update().catch(() => {}), 5 * 60 * 1000);
    }).catch(() => {});
  });
}
