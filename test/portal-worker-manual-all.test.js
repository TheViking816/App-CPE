import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync(new URL("../scripts/portal-sync-worker.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260818030000_worker_manual_sync_all.sql", import.meta.url), "utf8");

test("el worker cierra los procesos fallidos que quedaron running", () => {
  assert.match(worker, /failRunningJob/);
  assert.match(worker, /status=eq\.running/);
  assert.match(worker, /status: "failed"/);
});

test("la actualizacion total solo es accesible con service_role", () => {
  assert.match(migration, /app_cpe_create_worker_manual_jobs/);
  assert.match(migration, /revoke all[\s\S]*public, anon, authenticated/);
  assert.match(migration, /grant execute[\s\S]*service_role/);
  assert.match(migration, /where config\.enabled/);
});
