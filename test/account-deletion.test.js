import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../supabase/migrations/20260825002242_delete_app_cpe_account.sql", import.meta.url), "utf8");
const indexMigration = fs.readFileSync(new URL("../supabase/migrations/20260825002934_index_account_deletion_foreign_keys.sql", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const clientSource = fs.readFileSync(new URL("../src/supabaseClient.js", import.meta.url), "utf8");

test("la baja definitiva exige token, contraseña y confirmación explícita", () => {
  assert.match(migration, /app_cpe_user_from_token\(p_token\)/);
  assert.match(migration, /password_hash <> crypt\(coalesce\(p_current_password/);
  assert.match(migration, /upper\(trim\(coalesce\(p_confirmation, ''\)\)\) <> 'ELIMINAR'/);
  assert.match(migration, /revoke all on function public\.app_cpe_delete_account\(text, text, text\) from public, anon, authenticated/);
});

test("la baja elimina datos por chapa, relaciones del usuario y secretos del portal", () => {
  for (const table of ["app_cpe_portal_documents", "app_cpe_portal_preview_snapshots", "app_cpe_portal_snapshots", "app_cpe_portal_sync_jobs", "app_cpe_usage_events"]) {
    assert.match(migration, new RegExp(`delete from public\\.${table} where chapa = v_user\\.chapa`));
  }
  assert.match(migration, /delete from public\.app_cpe_users where id = v_user\.id/);
  assert.match(migration, /delete from vault\.secrets where id = v_password_secret_id/);
  assert.match(migration, /delete from vault\.secrets where id = v_security_secret_id/);
  assert.match(migration, /app_cpe_portal_documents_chapa_user_fkey/);
  assert.match(migration, /foreign key \(chapa\) references public\.app_cpe_users\(chapa\) on delete cascade/);
  assert.match(indexMigration, /app_cpe_portal_documents_chapa_idx/);
  assert.match(indexMigration, /app_cpe_portal_preview_snapshots_chapa_idx/);
});

test("la interfaz coloca la baja en Ajustes y limpia el almacenamiento local", () => {
  assert.match(clientSource, /supabase\.rpc\("app_cpe_delete_account"/);
  assert.match(appSource, /Eliminar mi cuenta/);
  assert.match(appSource, /Escribe ELIMINAR para confirmar/);
  assert.match(appSource, /Se borrarán la cuenta de la chapa/);
  assert.match(appSource, /removeStoredUserData\(chapa\)/);
  assert.match(appSource, /setSession\(null\)/);
});
