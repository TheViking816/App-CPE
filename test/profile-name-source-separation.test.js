import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const syncSource = await readFile(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");
const migrationSource = await readFile(
  new URL("../supabase/migrations/20260901131819_protect_user_chosen_display_names.sql", import.meta.url),
  "utf8"
);

test("portal sync updates specialties without overwriting the chosen profile name", () => {
  const functionBody = syncSource.match(/async function updateUserSpecialtiesFromPortal[\s\S]*?\n}\n/)?.[0] || "";

  assert.ok(functionBody);
  assert.doesNotMatch(functionBody, /display_name|identity|worker\.name/);
  assert.match(functionBody, /body\.specialties = userSpecialties\.ids/);
});

test("only the authenticated profile RPC can change display_name", () => {
  assert.match(migrationSource, /before update of display_name/i);
  assert.match(migrationSource, /allow_profile_display_name_update/i);
  assert.match(migrationSource, /app_cpe_user_from_token\(p_token\)/i);
  assert.match(migrationSource, /set display_name = v_display_name/i);
});
