import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260905030649_allow_admin_retry_disabled_portal_credentials.sql", import.meta.url), "utf8");
const enabledMigration = readFileSync(new URL("../supabase/migrations/20260905031044_keep_stored_portal_credentials_enabled.sql", import.meta.url), "utf8");
const monitor = readFileSync(new URL("../src/AdminMonitor.jsx", import.meta.url), "utf8");

test("el monitor conserva como seleccionable una contraseña guardada aunque haya sido rechazada", () => {
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
