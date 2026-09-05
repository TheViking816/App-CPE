import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const syncSource = await readFile(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");
const migrationSource = await readFile(
  new URL("../supabase/migrations/20260901083000_require_complete_requested_doubles_window.sql", import.meta.url),
  "utf8"
);

test("only a completely queried rolling doubles window may replace cached rows", () => {
  assert.match(
    syncSource,
    /dobles solicitados[\s\S]*isCompleteRequestedDoublesWindow,[\s\S]*allowCollectionShrink: true/
  );
  assert.match(syncSource, /waitForDoublesResult\(page, frame, date\)/);
  assert.match(syncSource, /const resultFrame = await waitForDoublesResult/);
});

test("Supabase stores recognized requested doubles as the authoritative rolling window", () => {
  assert.match(migrationSource, /\{dobles,recognized\}/);
  assert.match(migrationSource, /\{dobles,complete\}/);
  assert.match(migrationSource, /jsonb_array_length\(p_incoming #> '\{dobles,queriedDates\}'\)/);
  assert.match(migrationSource, /jsonb_typeof\(p_incoming #> '\{dobles,rows\}'\) = 'array'/);
  assert.match(migrationSource, /jsonb_set\(v_result, '\{dobles\}', p_incoming -> 'dobles', true\)/);
});
