import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../src/supabaseClient.js", import.meta.url), "utf8");
const schedulerSource = await readFile(new URL("../supabase/functions/schedule-portal-sync/index.ts", import.meta.url), "utf8");
const batchWorkflow = await readFile(new URL("../.github/workflows/sync-portals-batch.yml", import.meta.url), "utf8");
const migration = await readFile(
  new URL("../supabase/migrations/20260817103356_serialize_scheduled_portal_syncs.sql", import.meta.url),
  "utf8"
);

test("la actualización masiva desaparece de la app y de la base de datos", () => {
  assert.doesNotMatch(appSource, /Actualizar todos los usuarios|requestAllPortalSyncs/);
  assert.doesNotMatch(clientSource, /refresh-all-portals|requestAllPortalSyncs/);
  assert.match(migration, /drop function if exists public\.app_cpe_create_admin_portal_sync_jobs\(text\)/);
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
  assert.match(batchWorkflow, /for RAW_JOB_ID in/);
  assert.match(batchWorkflow, /CPE_PORTAL_SYNC_JOB_ID="\$JOB_ID" xvfb-run -a npm run sync:portal:job/);
});

test("solo quedan los cuatro horarios solicitados", () => {
  assert.match(appSource, /07:30, 12:15, 13:30 y 14:45/);
  for (const slot of ["07:30", "12:15", "13:30", "14:45"]) {
    assert.match(migration, new RegExp(`'${slot.replace(":", "\\:")}'`));
  }
  assert.doesNotMatch(migration, /'12:30'/);
  assert.doesNotMatch(migration, /lpad\(v_hour/);
  assert.match(migration, /interval '4 hours'/);
});
