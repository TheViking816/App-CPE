import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20260817082049_consolidate_portal_sync_jobs_per_chapa.sql", import.meta.url),
  "utf8"
);

test("la cola conserva una sola fila por chapa", () => {
  assert.match(migration, /row_number\(\) over \(partition by chapa/);
  assert.match(migration, /create unique index if not exists app_cpe_portal_sync_jobs_chapa_key/);
  assert.match(migration, /on conflict \(chapa\) do update set/);
});

test("todos los productores reutilizan la fila única de la chapa", () => {
  const calls = migration.match(/private\.app_cpe_queue_portal_sync_job\(/g) || [];
  assert.ok(calls.length >= 6);
  assert.doesNotMatch(migration, /insert into public\.app_cpe_portal_sync_jobs[\s\S]*?returning id into/);
});
