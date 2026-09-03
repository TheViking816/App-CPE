import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("src/App.jsx");
const monitor = read("src/AdminMonitor.jsx");
const client = read("src/supabaseClient.js");
const remoteWorker = read("scripts/remote-pending-worker-agent.js");

if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_GIT_COMMIT_REF) {
  assert.equal(process.env.VERCEL_GIT_COMMIT_REF, "main", "Producción solo se puede construir desde la rama main.");
}

assert.match(app, /Acceso al portal/, "Falta el acceso dedicado a las claves del portal.");
assert.match(app, /const credentialsOnly = view === "all"/, "Falta el aislamiento del formulario de claves.");
assert.doesNotMatch(app, /Datos guardados del portal oficial/, "Ha reaparecido el acceso a claves en las pantallas de datos.");
assert.doesNotMatch(app, />Cambiar acceso<\/button>/, "Ha reaparecido el botón de claves fuera de Ajustes.");
assert.match(monitor, /Ejecutar pendientes en el PC/, "Falta el control remoto de pendientes.");
assert.match(monitor, /Actualizar todos · mes actual/, "Falta el control remoto mensual.");
assert.match(client, /app_cpe_admin_request_pending_worker/, "Falta la orden remota de pendientes.");
assert.match(client, /app_cpe_admin_request_current_month_worker/, "Falta la orden remota mensual.");
assert.match(remoteWorker, /run-combined-current-sync\.ps1/, "El agente local no puede ejecutar la carga mensual.");

console.log("Protecciones de regresión de producción verificadas.");
