import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../src/supabaseClient.js", import.meta.url), "utf8");
const schedulerSource = await readFile(new URL("../supabase/functions/schedule-portal-sync/index.ts", import.meta.url), "utf8");
const refreshSource = await readFile(new URL("../supabase/functions/refresh-portal/index.ts", import.meta.url), "utf8");
const batchWorkflow = await readFile(new URL("../.github/workflows/sync-portals-batch.yml", import.meta.url), "utf8");
const batchScript = await readFile(new URL("../scripts/sync-portal-batch.js", import.meta.url), "utf8");
const serializedMigration = await readFile(
  new URL("../supabase/migrations/20260817104949_serialize_scheduled_portal_syncs.sql", import.meta.url),
  "utf8"
);
const scheduleMigration = await readFile(
  new URL("../supabase/migrations/20260817182201_set_requested_portal_sync_schedule.sql", import.meta.url),
  "utf8"
);

test("la actualización masiva desaparece de la app y de la base de datos", () => {
  assert.doesNotMatch(appSource, /Actualizar todos los usuarios|requestAllPortalSyncs/);
  assert.doesNotMatch(clientSource, /refresh-all-portals|requestAllPortalSyncs/);
  assert.match(serializedMigration, /drop function if exists public\.app_cpe_create_admin_portal_sync_jobs\(text\)/);
});

test("los fallos temporales no vuelven a abrir el formulario de claves", () => {
  assert.doesNotMatch(appSource, /credentialsRejected/);
  assert.match(appSource, /if \(job\.status === "failed"\)[\s\S]{0,300}?setShowCredentials\(false\)/);
  assert.doesNotMatch(appSource, /Revisa la contraseña del portal y vuelve a intentarlo/);
});

test("las sincronizaciones programadas se despachan como un solo lote secuencial", () => {
  assert.match(schedulerSource, /sync-portals-batch\.yml/);
  assert.match(schedulerSource, /dispatchWorkflow\(jobIds\)/);
  assert.doesNotMatch(schedulerSource, /for \(const job of jobs\)[\s\S]*?dispatchWorkflow\(job\.jobId\)/);
  assert.match(batchWorkflow, /npm run sync:portal:batch/);
  assert.match(batchScript, /for \(let index = 0; index < jobIds\.length; index \+= 1\)/);
  assert.match(batchScript, /await stopRemainingJobs\(remaining\)/);
  assert.match(batchScript, /setTimeout\(resolve, 30000\)/);
  assert.doesNotMatch(batchScript, /Promise\.all/);
});

test("solo quedan los ocho horarios solicitados", () => {
  assert.match(appSource, /02:00, 07:30, 08:00, 12:30, 14:00, 14:45, 15:00 y 20:00/);
  for (const slot of ["02:00", "07:30", "08:00", "12:30", "14:00", "14:45", "15:00", "20:00"]) {
    assert.match(scheduleMigration, new RegExp(`'${slot.replace(":", "\\:")}'`));
  }
  assert.doesNotMatch(scheduleMigration, /'12:15'|'13:30'/);
  assert.doesNotMatch(scheduleMigration, /lpad\(v_hour/);
  assert.match(scheduleMigration, /interval '4 hours'/);
});

test("el circuito de seguridad evita nuevos intentos durante dos horas tras un bloqueo", () => {
  for (const source of [schedulerSource, refreshSource]) {
    assert.match(source, /Date\.now\(\) - 2 \* 60 \* 60 \* 1000/);
    assert.match(source, /\.ilike\("message", "%bloqueado temporalmente%"\)/);
    assert.match(source, /portalBlocked: true/);
  }
  assert.match(schedulerSource, /dispatched: 0/);
});
