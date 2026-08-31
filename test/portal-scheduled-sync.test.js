import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../src/supabaseClient.js", import.meta.url), "utf8");
const schedulerSource = await readFile(new URL("../supabase/functions/schedule-portal-sync/index.ts", import.meta.url), "utf8");
const refreshSource = await readFile(new URL("../supabase/functions/refresh-portal/index.ts", import.meta.url), "utf8");
const batchWorkflow = await readFile(new URL("../.github/workflows/sync-portals-batch.yml", import.meta.url), "utf8");
const batchScript = await readFile(new URL("../scripts/sync-portal-batch.js", import.meta.url), "utf8");
const portalWorkerSource = await readFile(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");
const serializedMigration = await readFile(
  new URL("../supabase/migrations/20260817104949_serialize_scheduled_portal_syncs.sql", import.meta.url),
  "utf8"
);
const scheduleMigration = await readFile(
  new URL("../supabase/migrations/20260817182201_set_requested_portal_sync_schedule.sql", import.meta.url),
  "utf8"
);
const disabledScheduleMigration = await readFile(
  new URL("../supabase/migrations/20260818132200_disable_automatic_portal_sync.sql", import.meta.url),
  "utf8"
);
const removeMessagesMigration = await readFile(
  new URL("../supabase/migrations/20260823201254_remove_portal_messages_and_stale_sync_errors.sql", import.meta.url),
  "utf8"
);

test("la actualización masiva desaparece de la app y de la base de datos", () => {
  assert.doesNotMatch(appSource, /Actualizar todos los usuarios|requestAllPortalSyncs/);
  assert.doesNotMatch(clientSource, /refresh-all-portals|requestAllPortalSyncs/);
  assert.match(serializedMigration, /drop function if exists public\.app_cpe_create_admin_portal_sync_jobs\(text\)/);
});

test("un rechazo abre las claves y Ajustes mantiene siempre visible el formulario", () => {
  assert.match(appSource, /if \(job\.status === "failed"\)[\s\S]{0,500}?setShowCredentials\(credentialsOnly \|\| rejectedCredentials\)/);
  assert.match(appSource, /hasRejectedPortalCredentials\(job\.message\)/);
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

test("los horarios anteriores quedan documentados pero el productor automático está desactivado", () => {
  assert.doesNotMatch(appSource, /Sincronizacion automatica a las/);
  for (const slot of ["02:00", "07:30", "08:00", "12:30", "14:00", "14:45", "15:00", "20:00"]) {
    assert.match(scheduleMigration, new RegExp(`'${slot.replace(":", "\\:")}'`));
  }
  assert.doesNotMatch(scheduleMigration, /'12:15'|'13:30'/);
  assert.doesNotMatch(scheduleMigration, /lpad\(v_hour/);
  assert.match(scheduleMigration, /interval '4 hours'/);
  assert.match(disabledScheduleMigration, /cron\.unschedule/);
  assert.match(disabledScheduleMigration, /'disabled', true/);
  assert.match(disabledScheduleMigration, /delete from public\.app_cpe_portal_sync_jobs[\s\S]*trigger_source = 'scheduled'/);
});

test("las actualizaciones normales omiten nóminas y la app no ofrece sincronización manual", () => {
  assert.match(refreshSource, /body\.requestKind === "payrolls" \? "payrolls" : "snapshot"/);
  assert.match(clientSource, /requestKind: requestKind \|\| \(fullHistory \? "history" : "snapshot"\)/);
  assert.doesNotMatch(appSource, /Actualizar portal|Actualizar nóminas|Cargar todo el año/);
  assert.doesNotMatch(appSource, /requestPortalSync/);
  assert.match(appSource, /const saveCredentials = async/);
  assert.doesNotMatch(appSource, /Leyendo jornales, mensajes, dobles, nóminas y calendarios/);
});

test("los workers omiten mensajes y la app no muestra bandeja ni fallos de sincronización", () => {
  assert.doesNotMatch(portalWorkerSource, /\(\) => collectMessages\(page\)/);
  assert.doesNotMatch(portalWorkerSource, /publishProgress\("mensajes"/);
  assert.match(portalWorkerSource, /delete progressPayload\.mensajes/);
  assert.doesNotMatch(appSource, /className="header-inbox-button"/);
  assert.doesNotMatch(appSource, /payload\?\.sync\?\.failed && !hideSyncFailure/);
  assert.doesNotMatch(appSource, /payload\.sync\.error \|\|/);
  assert.doesNotMatch(appSource, /setPortalMessage\(requestError\.message/);
  assert.match(removeMessagesMigration, /v_result := private\.app_cpe_preserve_nonempty_portal_sections\(p_existing, p_incoming\) - 'mensajes'/);
  assert.match(removeMessagesMigration, /update public\.app_cpe_portal_snapshots/);
});

test("el circuito de seguridad evita nuevos intentos durante dos horas tras un bloqueo", () => {
  for (const source of [schedulerSource, refreshSource]) {
    assert.match(source, /Date\.now\(\) - 2 \* 60 \* 60 \* 1000/);
    assert.match(source, /\.ilike\("message", "%bloqueado temporalmente%"\)/);
    assert.match(source, /portalBlocked: true/);
  }
  assert.match(schedulerSource, /dispatched: 0/);
});
