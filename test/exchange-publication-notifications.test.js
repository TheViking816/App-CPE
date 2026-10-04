import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const migration = await fs.readFile(new URL("../supabase/migrations/20261004222838_notify_exchange_offer_publications.sql", import.meta.url), "utf8");

test("cada publicación correcta crea novedades para todos los usuarios", () => {
  assert.match(migration, /after insert on public\.app_cpe_rest_offers/);
  assert.match(migration, /after insert on public\.app_cpe_vacation_offers/);
  assert.equal((migration.match(/from public\.app_cpe_users recipient/g) || []).length, 2);
  assert.match(migration, /on conflict \(chapa, event_type, entity_key, change_hash\) do nothing/g);
  assert.match(migration, /new\.id::text, new\.id::text, 'descansos'/);
  assert.match(migration, /new\.id::text, new\.id::text, 'vacaciones'/);
});

test("el resumen diferencia intercambio, cesión, solicitud y periodos de vacaciones", () => {
  assert.match(migration, /when 'swap' then 'Nuevo intercambio de descansos'/);
  assert.match(migration, /when 'give' then 'Nueva cesión de descanso'/);
  assert.match(migration, /else 'Nueva solicitud de cesión'/);
  assert.match(migration, /new\.offered_end <> new\.offered_start/);
  assert.match(migration, /new\.wanted_end <> new\.wanted_start/);
});
