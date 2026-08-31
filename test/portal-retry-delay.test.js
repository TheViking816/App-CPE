import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../supabase/migrations/20260831073254_reduce_portal_retry_to_two_minutes.sql", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../scripts/portal-sync-worker.js", import.meta.url), "utf8");

test("el reintento automático del portal queda programado a dos minutos", () => {
  assert.match(migration, /worker_retry_2m/);
  assert.match(migration, /requested_at = now\(\) \+ interval '2 minutes'/);
  assert.match(migration, /programado para dentro de 2 minutos/);
  assert.doesNotMatch(migration, /interval '5 minutes'/);
  assert.match(worker, /programado para dentro de 2 minutos/);
});
