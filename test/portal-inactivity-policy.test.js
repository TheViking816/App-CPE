import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../supabase/migrations/20261002013720_pause_inactive_portal_syncs_and_resume_on_visit.sql", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../scripts/portal-sync-worker.js", import.meta.url), "utf8");

test("pausa tras siete días sin borrar claves ni snapshots", () => {
  assert.match(migration, /last_app_seen_at < pg_catalog\.now\(\) - interval '7 days'/);
  assert.match(migration, /last_app_seen_at is null/);
  assert.match(migration, /sync_status = 'paused_inactive'/);
  assert.match(migration, /pause_reason = 'inactivity_7_days'/);
  assert.match(migration, /cron\.schedule\([\s\S]*app-cpe-pause-inactive-portal-syncs/);
  assert.doesNotMatch(migration, /delete from public\.app_cpe_(portal_auto_sync|portal_snapshots)/i);
});

test("ejecutar todos y pendientes ignoran pausados incluso si había trabajos en cola", () => {
  assert.match(migration, /app_cpe_create_worker_manual_jobs[\s\S]*app_cpe_pause_inactive_portal_syncs\(\)/);
  assert.match(migration, /app_cpe_claim_eligible_portal_sync_jobs[\s\S]*c\.sync_status = 'active'/);
  assert.match(migration, /app_cpe_next_eligible_portal_sync_at[\s\S]*c\.sync_status = 'active'/);
  assert.match(worker, /app_cpe_claim_eligible_portal_sync_jobs/);
  assert.match(worker, /app_cpe_next_eligible_portal_sync_at/);
});

test("una visita real reactiva y el acceso de soporte no cuenta", () => {
  assert.match(migration, /if v_is_support_session then[\s\S]*'tracked', false/);
  assert.match(migration, /v_config\.sync_status = 'paused_inactive'[\s\S]*app_cpe_reactivate_portal_sync\(p_token\)/);
  assert.match(migration, /revoke all on function public\.app_cpe_claim_eligible_portal_sync_jobs\(integer\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.app_cpe_claim_eligible_portal_sync_jobs\(integer\) to service_role/);
});
