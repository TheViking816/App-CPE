import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260905030649_allow_admin_retry_disabled_portal_credentials.sql", import.meta.url), "utf8");
const enabledMigration = readFileSync(new URL("../supabase/migrations/20260905031044_keep_stored_portal_credentials_enabled.sql", import.meta.url), "utf8");
const blockedMigration = readFileSync(new URL("../supabase/migrations/20260905032756_block_sync_until_portal_password_changes.sql", import.meta.url), "utf8");
const monitor = readFileSync(new URL("../src/AdminMonitor.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("el monitor distingue una contraseña guardada aunque haya sido rechazada", () => {
  assert.match(migration, /'hasCredentials', config\.portal_password_secret_id is not null/);
  assert.doesNotMatch(migration, /where chapa = v_chapa and enabled/);
  assert.match(monitor, /user\.syncStatus === "credentials_error"\s*\? "clave incorrecta"/);
  assert.match(monitor, /Contraseña guardada, pero rechazada por el portal/);
});

test("un reintento administrativo reactiva la credencial antes de ponerla en cola", () => {
  assert.match(migration, /update public\.app_cpe_portal_auto_sync set enabled = true/);
  assert.match(migration, /private\.app_cpe_queue_portal_sync_job/);
});

test("un rechazo conserva enabled=true y registra el error por separado", () => {
  assert.match(enabledMigration, /set sync_status = 'credentials_error'/);
  assert.doesNotMatch(enabledMigration, /set enabled = false/);
  assert.match(enabledMigration, /where portal_password_secret_id is not null\s+and not enabled/);
});

test("una contraseña rechazada no puede volver a encolarse hasta que cambie", () => {
  assert.match(monitor, /\["paused_inactive", "credentials_error"\]\.includes\(user\.syncStatus\)/);
  assert.match(blockedMigration, /config\.sync_status = 'credentials_error'/);
  assert.match(blockedMigration, /Sincronización bloqueada: el usuario debe cambiar la contraseña del portal/);
  assert.match(blockedMigration, /before update of portal_password_secret_id/);
});

test("la aplicación avisa del rechazo y abre el formulario para cambiar la contraseña", () => {
  assert.match(app, /Revisa tu contraseña del Portal CPE/);
  assert.match(app, /Cambiar contraseña/);
  assert.match(app, /portalSyncStatus === "credentials_error" && activeTab !== "portal"/);
  assert.match(app, /setShowCredentials\(true\)/);
  assert.match(app, /portalSyncStatus === "active" && session\.portalActivationStatus === "pending"/);
});
