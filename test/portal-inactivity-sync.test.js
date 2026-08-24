import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../supabase/migrations/20260824180858_pause_inactive_portal_sync_and_bootstrap_security_key.sql", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const clientSource = fs.readFileSync(new URL("../src/supabaseClient.js", import.meta.url), "utf8");
const monitorSource = fs.readFileSync(new URL("../src/AdminMonitor.jsx", import.meta.url), "utf8");

test("añadir la clave de seguridad encola una recuperación anual individual", () => {
  assert.match(migration, /app_cpe_set_portal_security_key[\s\S]*security_key_added[\s\S]*'history'/);
  assert.match(migration, /now\(\) \+ interval '30 days'/);
  assert.match(appSource, /Clave guardada\. La carga completa anual está en cola/);
});

test("las cuentas se pausan tras siete días sin borrar datos ni credenciales", () => {
  assert.match(migration, /sync_status = 'paused_inactive'/);
  assert.match(migration, /last_app_seen_at < now\(\) - interval '7 days'/);
  assert.match(migration, /config\.sync_status = 'active'/);
  assert.doesNotMatch(migration, /delete from public\.app_cpe_portal_auto_sync[\s\S]*inactivity_7_days/);
  assert.match(appSource, /if \(session\.token\) touchPortalActivity/);
});

test("el usuario puede reactivar su propia cola desde la aplicación", () => {
  assert.match(migration, /app_cpe_reactivate_portal_sync\(p_token text\)/);
  assert.match(migration, /v_user := public\.app_cpe_user_from_token\(p_token\)/);
  assert.match(clientSource, /app_cpe_reactivate_portal_sync/);
  assert.match(appSource, /Actualizaciones en pausa por inactividad/);
  assert.match(appSource, /Reactivar actualizaciones/);
});

test("el monitor distingue las cuentas pausadas", () => {
  assert.match(migration, /'syncStatus'.*config\.sync_status/s);
  assert.match(monitorSource, /\["paused", "En pausa"\]/);
  assert.match(monitorSource, /user\.syncStatus === "paused_inactive"/);
});
