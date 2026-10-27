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
import "./generalBoardManual.css";
import "./manualCompact.css";
import "./manualOperationalLegacy.css";
import "./manualOperational.css";
import "./portalJornalesImport.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ManualApp />
  </React.StrictMode>
);

// Vite changes the entry bundle name on every code deployment. Check the live
// HTML as well as the service worker, whose script may stay identical.
if (import.meta.env.PROD) {
  const currentBundle = document.querySelector('script[type="module"][src]')?.getAttribute('src');
  if (currentBundle) {
    const reloadTargetKey = "app-cpe-auto-reload-target";
    if (sessionStorage.getItem(reloadTargetKey) === currentBundle) {
      sessionStorage.removeItem(reloadTargetKey);
    }
    let checking = false;
    const checkForNewVersion = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}?app_cpe_check=${Date.now()}`, {
          cache: "no-store",
          credentials: "same-origin"
        });
        if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return;
        const page = new DOMParser().parseFromString(await response.text(), "text/html");
        const latestBundle = page.querySelector('script[type="module"][src]')?.getAttribute('src');
        if (latestBundle && latestBundle !== currentBundle
          && sessionStorage.getItem(reloadTargetKey) !== latestBundle) {
          sessionStorage.setItem(reloadTargetKey, latestBundle);
          window.location.reload();
        }
      } catch {
        // An offline tab will retry when connectivity returns.
      } finally {
        checking = false;
      }
    };
    window.setInterval(checkForNewVersion, 30_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForNewVersion();
    });
    window.addEventListener("focus", checkForNewVersion);
  }
}

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
      forceReload("20261027-calendar-swipe-66");
    });
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "APP_CPE_FORCE_RELOAD") forceReload(event.data.version);
    });

    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js?v=20261027-calendar-swipe-66`, {
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
