import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260829100856_restrict_activity_sync_to_reactivation.sql", import.meta.url),
  "utf8"
);

test("una apertura activa solo actualiza last seen y no encola por antigüedad del snapshot", () => {
  assert.match(migration, /else[\s\S]*set last_app_seen_at = now\(\)/);
  assert.doesNotMatch(migration, /interval '15 minutes'/);
  assert.doesNotMatch(migration, /'app_activity_refresh'/);
});

test("volver tras siete días reactiva y encola una sola lectura", () => {
  assert.match(migration, /sync_status = 'paused_inactive'[\s\S]*interval '7 days'/);
  assert.match(migration, /not exists[\s\S]*status in \('queued', 'running'\)/);
  assert.match(migration, /'app_activity_reactivated'/);
  assert.match(migration, /'snapshot'/);
  assert.match(migration, /retry_count = 0/);
});
