import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260901125148_exclude_support_session_usage.sql",
  import.meta.url
);

test("master-password sessions are marked and rejected by page tracking", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /add column if not exists is_support boolean not null default false/i);
  assert.match(migration, /set is_support = true/i);
  assert.match(migration, /'supportAccess'.*select s\.is_support/is);
  assert.match(migration, /v_is_support_session or v_user\.chapa = '72683'/i);
  assert.match(migration, /'tracked', false/i);
  assert.match(migration, /'reason'.*'support_session'/is);
});

test("the client does not emit usage events for support access", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

  assert.match(app, /if \(!response\.supportAccess\)/);
  assert.match(app, /if \(!session\.supportAccess\)/);
  assert.match(app, /session\.supportAccess \|\| !activeTab/);
});
