import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("admin selective sync validates the custom admin session and never exposes secrets", async () => {
  const sql = await read("../supabase/migrations/20260818133401_admin_selective_portal_sync.sql");
  assert.match(sql, /v_admin\.chapa <> '72683'/);
  assert.match(sql, /app_cpe_admin_queue_portal_sync_users/);
  assert.match(sql, /grant execute on function public\.app_cpe_admin_queue_portal_sync_users\(text, text\[\]\) to anon, authenticated/);
  assert.doesNotMatch(sql.match(/app_cpe_admin_portal_sync_users[\s\S]*?end;\n\$\$;/)?.[0] || "", /decrypted_secret/);
});

test("admin selective sync queues only the selected chapas and preserves active jobs", async () => {
  const sql = await read("../supabase/migrations/20260818133401_admin_selective_portal_sync.sql");
  assert.match(sql, /from unnest\(p_chapas\)/);
  assert.match(sql, /v_existing\.status in \('queued', 'running'\)/);
  assert.match(sql, /'admin_selected'/);
  assert.match(sql, /portal_activation_status = 'pending'.*?'history'/s);
});

test("legacy users without portal data re-enter onboarding and null payload opens credentials", async () => {
  const [sql, repairSql, app] = await Promise.all([
    read("../supabase/migrations/20260818133401_admin_selective_portal_sync.sql"),
    read("../supabase/migrations/20260818134813_repair_vault_links_and_legacy_activation.sql"),
    read("../src/App.jsx")
  ]);
  assert.match(sql, /created_at < timestamptz '2026-08-18 12:10:38\+00'/);
  assert.match(sql, /app_cpe_update_activation_email/);
  assert.match(repairSql, /portal_activation_status = 'active'/);
  assert.match(repairSql, /portal_activation_status = 'pending'/);
  assert.match(app, /setShowCredentials\(!data\?\.payload \|\| rejectedCredentials\)/);
  assert.match(app, /updateActivationEmail/);
});

test("orphaned Vault credentials are reconnected and unrelated legacy accounts stay out of Monitor", async () => {
  const sql = await read("../supabase/migrations/20260818134813_repair_vault_links_and_legacy_activation.sql");
  assert.match(sql, /app_cpe_portal_password_\[0-9\]\{5\}/);
  assert.match(sql, /insert into public\.app_cpe_portal_auto_sync/);
  assert.match(sql, /config\.chapa is not null or users\.portal_activation_status = 'pending'/);
});

test("Monitor exposes individual and multi-user queue controls", async () => {
  const monitor = await read("../src/AdminMonitor.jsx");
  assert.match(monitor, /Sincronizar usuarios concretos/);
  assert.match(monitor, /Actualizar mes actual/);
  assert.match(monitor, /Carga inicial completa/);
  assert.match(monitor, /Actualizar pendientes App CPE/);
  assert.match(monitor, /Seleccionar chapa/);
  assert.ok(monitor.indexOf("monitor-recent-card") < monitor.indexOf("monitor-sync-card"));
});

test("full initial sync is explicit and queues annual history", async () => {
  const [monitor, client, migration, workerJob, sync] = await Promise.all([
    read("../src/AdminMonitor.jsx"),
    read("../src/supabaseClient.js"),
    read("../supabase/migrations/20260819025819_preserve_portal_history_and_bootstrap_sync.sql"),
    read("../scripts/sync-portal-oficial-job.js"),
    read("../scripts/sync-portal-oficial.js")
  ]);
  assert.match(monitor, /queueSelected\(\{ fullHistory: true \}\)/);
  assert.match(client, /p_full_history: fullHistory/);
  assert.match(migration, /when p_full_history.*then 'history'/s);
  assert.match(workerJob, /CPE_PORTAL_REQUEST_KIND: job\.request_kind \|\| "snapshot"/);
  assert.match(sync, /portalRequestKind === "history"[\s\S]{0,160}collectPayrollDocumentFiles/);
  assert.match(sync, /"nominas y documentos"/);
});

test("database snapshot updates merge histories instead of replacing them", async () => {
  const migration = await read("../supabase/migrations/20260819025819_preserve_portal_history_and_bootstrap_sync.sql");
  assert.match(migration, /app_cpe_merge_portal_period_section/);
  assert.match(migration, /distinct on \(period_year, period_month\)/);
  assert.match(migration, /before update of payload on public\.app_cpe_portal_snapshots/);
  assert.match(migration, /coalesce\(p_existing, '\{\}'::jsonb\) \|\| coalesce\(p_incoming, '\{\}'::jsonb\)/);
});

test("Monitor identifies users that need historical recovery", async () => {
  const [monitor, migration] = await Promise.all([
    read("../src/AdminMonitor.jsx"),
    read("../supabase/migrations/20260819031058_expose_portal_history_recovery_status.sql")
  ]);
  assert.match(migration, /'hasPremiumHistory'/);
  assert.match(migration, /'premiumHistoryMonths'/);
  assert.match(monitor, /\["history", "Sin histórico"\]/);
  assert.match(monitor, /Sin histórico de primas · usa Carga inicial completa/);
});

test("private history protection works through the service worker and rejects bad passwords", async () => {
  const migration = await read("../supabase/migrations/20260819061655_fix_private_history_trigger_and_reject_bad_credentials.sql");
  assert.match(migration, /app_cpe_preserve_portal_snapshot_trigger\(\)[\s\S]*security definer/);
  assert.match(migration, /app_cpe_retire_rejected_portal_credentials/);
  assert.match(migration, /set enabled = false/);
  assert.match(migration, /delete from public\.app_cpe_portal_sync_jobs where id = new\.id/);
  assert.match(migration, /usuario\[\[:space:\]\]\+o/);
  assert.doesNotMatch(migration, /grant usage on schema private/);
});
