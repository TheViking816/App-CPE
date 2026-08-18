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
  const [sql, app] = await Promise.all([
    read("../supabase/migrations/20260818133401_admin_selective_portal_sync.sql"),
    read("../src/App.jsx")
  ]);
  assert.match(sql, /created_at < timestamptz '2026-08-18 12:10:38\+00'/);
  assert.match(sql, /app_cpe_update_activation_email/);
  assert.match(app, /setShowCredentials\(!data\?\.payload\)/);
  assert.match(app, /updateActivationEmail/);
});

test("Monitor exposes individual and multi-user queue controls", async () => {
  const monitor = await read("../src/AdminMonitor.jsx");
  assert.match(monitor, /Sincronizar usuarios concretos/);
  assert.match(monitor, /Poner seleccionados en cola/);
  assert.match(monitor, /Actualizar pendientes App CPE/);
  assert.match(monitor, /Seleccionar chapa/);
});
