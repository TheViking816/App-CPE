import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../src/supabaseClient.js", import.meta.url), "utf8");
const migrationSource = await readFile(
  new URL("../supabase/migrations/20260826063405_add_user_profile_preferences.sql", import.meta.url),
  "utf8"
);

test("el usuario edita su nombre y la privacidad de la chapa desde Ajustes", () => {
  assert.match(appSource, /Nombre y privacidad/);
  assert.match(appSource, /Mostrar mi chapa en el foro/);
  assert.match(appSource, /displayName=\{session\.displayName\}/);
  assert.match(clientSource, /app_cpe_update_profile/);
});

test("el perfil valida el nombre y solo actualiza al propietario de la sesión", () => {
  assert.match(migrationSource, /app_cpe_user_from_token\(p_token\)/);
  assert.match(migrationSource, /where id = v_user\.id/);
  assert.match(migrationSource, /char_length\(v_display_name\) < 1 or char_length\(v_display_name\) > 40/);
  assert.match(migrationSource, /revoke all on function public\.app_cpe_update_profile/);
});

test("el foro resuelve el nombre y la chapa desde la preferencia actual", () => {
  assert.match(migrationSource, /join public\.app_cpe_users author on author\.id = m\.user_id/);
  assert.match(migrationSource, /author\.forum_show_chapa/);
  assert.match(appSource, /forum-chapa-badge/);
});
