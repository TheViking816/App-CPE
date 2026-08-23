import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const syncSource = await readFile(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");
const migrationSource = await readFile(
  new URL("../supabase/migrations/20260822053220_preserve_nonempty_portal_sections.sql", import.meta.url),
  "utf8"
);
const mergeOrderFixSource = await readFile(
  new URL("../supabase/migrations/20260822053508_apply_nonempty_guard_before_history_merges.sql", import.meta.url),
  "utf8"
);

test("la captura conserva una coleccion anterior si la nueva seccion llega vacia", () => {
  assert.match(syncSource, /protectedCollectionKeys/);
  assert.match(syncSource, /value\[key\]\.length < fallback\[key\]\.length/);
  assert.match(syncSource, /!wouldEraseStoredCollection\(value, fallback\)/);
});

test("la base de datos protege las colecciones y fusiona el historico de excepciones", () => {
  assert.match(migrationSource, /array\['rows', 'months', 'history', 'rules'\]/);
  assert.match(migrationSource, /jsonb_array_length\(\(p_incoming -> v_section\.key\) -> v_collection_key\)[\s\S]*< jsonb_array_length\(v_section\.value -> v_collection_key\)/);
  assert.match(migrationSource, /app_cpe_merge_portal_exception_section/);
  assert.match(migrationSource, /priority desc/);
  assert.match(migrationSource, /app_cpe_preserve_nonempty_portal_sections\(p_existing, p_incoming\)/);
  assert.match(mergeOrderFixSource, /v_result -> 'jornales'/);
  assert.match(mergeOrderFixSource, /v_result -> 'primas'/);
  assert.match(mergeOrderFixSource, /v_result -> 'excepciones'/);
});
