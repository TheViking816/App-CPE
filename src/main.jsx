import React from "react";
import { createRoot } from "react-dom/client";
import { ManualApp } from "./ManualApp.jsx";
import "./manual.css";
import "./manualSalaryVisual.css";
import "./manualProductionJornales.css";
import "./exchangeLegacy.css";
import "./exchangeRedesign.css";
import "./exchangeThemeA.css";
import "./exchangeBoardCalendar.css";
import "./manualNavigation.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ManualApp />
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    let refreshing = false;
    const forceReload = (version = "controller") => {
      if (refreshing) return;
      const reloadKey = `app-cpe-reloaded-${version}`;
      if (sessionStorage.getItem(reloadKey)) return;
      sessionStorage.setItem(reloadKey, "1");
      refreshing = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      forceReload("20261008-exchanges-2");
    });
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "APP_CPE_FORCE_RELOAD") forceReload(event.data.version);
    });

    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js?v=20261008-exchanges-2`, {
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
