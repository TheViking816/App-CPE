import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260925231550_populate_missing_portal_names.sql", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("solo se completa un nombre vacío con el titular verificado del portal", () => {
  assert.match(migration, /worker,chapa}' is distinct from new\.chapa/);
  assert.match(migration, /nullif\(btrim\(u\.display_name\), ''\) is null/);
  assert.match(migration, /after insert or update of payload on public\.app_cpe_portal_snapshots/);
});

test("el nombre elegido en el perfil sigue siendo el visible en la app", () => {
  assert.match(app, /const visibleName = String\(displayName \|\| ""\)/);
  assert.match(app, /Se mostrará en Inicio, chats, intercambios y el foro/);
});
