import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("src/App.jsx");
const monitor = read("src/AdminMonitor.jsx");
const client = read("src/supabaseClient.js");
const remoteWorker = read("scripts/remote-pending-worker-agent.js");
const currentAssignments = read("src/currentAssignments.js");
const payroll = read("src/payroll.js");
const fullPartMerge = read("src/fullPartMerge.js");
const styles = read("src/styles.css");

if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_GIT_COMMIT_REF) {
  assert.equal(process.env.VERCEL_GIT_COMMIT_REF, "main", "Producción solo se puede construir desde la rama main.");
}

assert.match(app, /Acceso al portal/, "Falta el acceso dedicado a las claves del portal.");
assert.match(app, /const credentialsOnly = view === "all"/, "Falta el aislamiento del formulario de claves.");
assert.doesNotMatch(app, /Datos guardados del portal oficial/, "Ha reaparecido el acceso a claves en las pantallas de datos.");
assert.doesNotMatch(app, />Cambiar acceso<\/button>/, "Ha reaparecido el botón de claves fuera de Ajustes.");
assert.match(app, /Noray\/Prueba\.asp\?f=1&mode=GWT&devType=Desktop&device=Desktop&browser=Chrome&os=Windows/, "El enlace para gestionar descansos no apunta a la vista completa del portal.");
assert.match(app, /Centro de novedades/, "Ha desaparecido el centro de novedades.");
assert.match(app, /findPartBolsaWorkers/, "Ha desaparecido la carga de nombres de bolsa en los partes.");
assert.match(app, /mergeFullPartSpecialties/, "Ha desaparecido la unión del parte completo con la bolsa.");
assert.match(fullPartMerge, /formatFullPartWorkerCode/, "Falta el formateo de chapas de bolsa en los partes.");
assert.match(app, /workers\.length > 0 && workers\.every/, "Ha desaparecido el bloque compacto común para trastáineres y máquinas.");
assert.match(styles, /\.assignment-detail-workers \.is-code-grid p\.is-current-worker/, "Falta el diseño de partes para trastáineres y máquinas.");
assert.match(currentAssignments, /canonicalPortalPart/, "Falta la deduplicación de jornadas de clasificadores en Contratación.");
assert.match(currentAssignments, /normalizeReservePortalRow/, "Falta la normalización de reservas de clasificadores.");
assert.match(payroll, /normalizeReservePortalRow/, "Falta la deduplicación de jornadas de clasificadores en Sueldómetro.");
assert.match(monitor, /Ejecutar pendientes en el PC/, "Falta el control remoto de pendientes.");
assert.match(monitor, /Actualizar todos · mes actual/, "Falta el control remoto mensual.");
assert.match(monitor, /Escanear nombres de bolsa/, "Falta el control remoto del escaneo de bolsa.");
assert.match(client, /app_cpe_admin_request_pending_worker/, "Falta la orden remota de pendientes.");
assert.match(client, /app_cpe_admin_request_current_month_worker/, "Falta la orden remota mensual.");
assert.match(client, /app_cpe_admin_request_bolsa_name_scan/, "Falta la orden remota del escaneo de bolsa.");
assert.match(remoteWorker, /run-combined-current-sync\.ps1/, "El agente local no puede ejecutar la carga mensual.");
assert.match(remoteWorker, /run-bolsa-name-scan\.ps1/, "El agente local no puede ejecutar el escaneo de bolsa.");

console.log("Protecciones de regresión de producción verificadas.");
