import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const navigationSource = await readFile(new URL("../src/navigation.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../src/supabaseClient.js", import.meta.url), "utf8");
const migrationSource = await readFile(
  new URL("../supabase/migrations/20260825123000_add_secure_app_cpe_forum.sql", import.meta.url),
  "utf8"
);

test("el foro forma parte de la navegacion y usa RPC autenticadas", () => {
  assert.match(navigationSource, /"foro"/);
  assert.match(appSource, /<ForumPanel session=\{session\}/);
  assert.match(clientSource, /app_cpe_forum_list/);
  assert.match(clientSource, /app_cpe_forum_post/);
});

test("el foro protege la tabla y muestra al administrador sin exponer la chapa", () => {
  assert.match(migrationSource, /enable row level security/i);
  assert.match(migrationSource, /revoke all on table public\.app_cpe_forum_messages from public, anon, authenticated/i);
  assert.match(
    migrationSource,
    /if v_user\.chapa = '72683' then[\s\S]*v_name := 'Administrador'/i,
  );
  assert.match(migrationSource, /Bienvenidos al foro de App CPE/i);
});
