import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260905112848_notify_after_corrected_security_key.sql", import.meta.url),
  "utf8"
);

test("a corrected existing security key rearms the first-history email", () => {
  assert.match(migration, /new\.security_key_secret_id is not null/);
  assert.doesNotMatch(migration, /old\.security_key_secret_id is null\s+and new\.security_key_secret_id/);
  assert.match(migration, /fullHistoryCompletedAt/);
  assert.match(migration, /new\.premium_history_email_pending_at := now\(\)/);
});

test("a corrected key also recovers the missing administrator notice", () => {
  assert.match(migration, /if v_needs_initial_history then[\s\S]*admin_security_key_added/);
});
