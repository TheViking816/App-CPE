import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sessionMigrationUrl = new URL(
  "../supabase/migrations/20260901125148_exclude_support_session_usage.sql",
  import.meta.url
);
const privacyMigrationUrl = new URL(
  "../supabase/migrations/20260902021626_hide_master_sessions_from_usage.sql",
  import.meta.url
);

test("master-password sessions are marked and rejected by page tracking", async () => {
  const migration = await readFile(sessionMigrationUrl, "utf8");

  assert.match(migration, /add column if not exists is_support boolean not null default false/i);
  assert.match(migration, /set is_support = true/i);
  assert.match(migration, /'supportAccess'.*select s\.is_support/is);
  assert.match(migration, /v_is_support_session or v_user\.chapa = '72683'/i);
  assert.match(migration, /'tracked', false/i);
  assert.match(migration, /'reason'.*'support_session'/is);
});

test("master-password login and portal activity leave no usage rows", async () => {
  const migration = await readFile(privacyMigrationUrl, "utf8");

  assert.match(migration, /v_is_support_session := v_is_support_password;/i);
  assert.doesNotMatch(migration, /insert into public\.app_cpe_usage_events[\s\S]*support_login/i);
  assert.match(migration, /delete from public\.app_cpe_usage_events[\s\S]*event_type = 'support_login'/i);
  assert.match(migration, /app_cpe_touch_portal_activity[\s\S]*if v_is_support_session then[\s\S]*'tracked', false/i);
});

test("the client does not emit usage events for support access", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

  assert.match(app, /if \(!response\.supportAccess\)/);
  assert.match(app, /if \(!session\.supportAccess\)/);
  assert.match(app, /session\.supportAccess \|\| !activeTab/);
  assert.match(app, /session\.supportAccess\s*\? Promise\.resolve\(null\)\s*:\s*touchPortalActivity/);
  assert.match(app, /session\.token && !session\.supportAccess/);
});
