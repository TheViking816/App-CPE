import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const syncSource = await readFile(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");
const migrationSource = await readFile(
  new URL("../supabase/migrations/20260831080518_use_authoritative_requested_doubles.sql", import.meta.url),
  "utf8"
);

test("a recognized rolling doubles window may replace a longer cached window", () => {
  assert.match(
    syncSource,
    /dobles solicitados[\s\S]*hasVacationData,[\s\S]*allowCollectionShrink: true/
  );
});

test("Supabase stores recognized requested doubles as the authoritative rolling window", () => {
  assert.match(migrationSource, /\{dobles,recognized\}/);
  assert.match(migrationSource, /jsonb_typeof\(p_incoming #> '\{dobles,rows\}'\) = 'array'/);
  assert.match(migrationSource, /jsonb_set\(v_result, '\{dobles\}', p_incoming -> 'dobles', true\)/);
});
