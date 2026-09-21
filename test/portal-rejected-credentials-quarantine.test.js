import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL(
  "../supabase/migrations/20260921200950_quarantine_rejected_portal_credentials.sql",
  import.meta.url
), "utf8");

test("una contraseña rechazada queda en cuarentena sin borrar su configuración", () => {
  const quarantineFunction = sql.match(
    /create or replace function private\.app_cpe_retire_rejected_portal_credentials\(\)[\s\S]*?\$\$;/
  )?.[0] || "";

  assert.ok(quarantineFunction);
  assert.match(sql, /contrase\[nñ\]a/);
  assert.match(quarantineFunction, /set enabled = false,[\s\S]*sync_status = 'credentials_error'/);
  assert.doesNotMatch(quarantineFunction, /delete from/);
});

test("la contraseña corregida encola history y sigue aislada hasta validarse", () => {
  assert.match(sql, /and not \([\s\S]*p_trigger_source = 'credentials_corrected'[\s\S]*p_request_kind = 'history'/);
  assert.match(sql, /'credentials_corrected',[\s\S]*'history'/);
  assert.match(sql, /'validationPending', true/);
  assert.match(sql, /not v_was_credentials_error/);
  assert.match(sql, /new\.trigger_source = 'credentials_corrected'/);
  assert.match(sql, /new\.request_kind = 'history'/);
  assert.match(sql, /set enabled = true,[\s\S]*sync_status = 'active'/);
});

test("las funciones privilegiadas fijan un search_path vacío", () => {
  const definitions = sql.match(/create or replace function[\s\S]*?\$\$;/g) || [];
  assert.ok(definitions.length >= 3);
  for (const definition of definitions) assert.match(definition, /set search_path = ''/);
});
