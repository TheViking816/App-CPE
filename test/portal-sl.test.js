import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { markAuthoritativeSl, parseSl, wouldEraseStoredCollection } from "../scripts/sync-portal-oficial.js";

const authoritativeSlMigration = await readFile(
  new URL("../supabase/migrations/20260916215406_prefer_authoritative_sl_rows.sql", import.meta.url),
  "utf8"
);

test("parseSl reads dates and positions without requiring zero-padded dates", () => {
  const result = parseSl(`
    <table>
      <tr><th>Fecha</th><th>Posicion</th></tr>
      <tr><td>9/9/2026</td><td>12</td></tr>
      <tr><td>12/09/2026</td><td>5 posiciones</td></tr>
    </table>
  `);

  assert.deepEqual(result, {
    recognized: true,
    rows: [
      { fecha: "09/09/2026", posicion: "12" },
      { fecha: "12/09/2026", posicion: "5" }
    ]
  });
});

test("parseSl rejects unrelated portal pages", () => {
  assert.deepEqual(parseSl("<table><tr><td>Inicio</td></tr></table>"), {
    recognized: false,
    rows: []
  });
});

test("parseSl recognizes a valid empty SL table", () => {
  assert.deepEqual(parseSl(`
    <table>
      <tr><th>Fecha</th><th>Posicion</th></tr>
    </table>
  `), {
    recognized: true,
    rows: []
  });
});

test("marca una generación SL autoritativa para ignorar posiciones fusionadas antiguas", () => {
  const marked = markAuthoritativeSl({
    recognized: true,
    rows: [
      { fecha: "20/09/2026", posicion: "1" },
      { fecha: "19/09/2026", posicion: "3" }
    ]
  }, "2026-09-16T22:59:00.000Z");

  assert.equal(marked.revision, "19/09/2026:3|20/09/2026:1");
  assert.equal(marked.observedAt, "2026-09-16T22:59:00.000Z");
  assert.ok(marked.rows.every((row) => row.revision === marked.revision));
});

test("a fresh SL list may replace a longer cached list", () => {
  const cached = {
    rows: [
      { fecha: "28/08/2026", posicion: "9" },
      { fecha: "02/09/2026", posicion: "11" }
    ]
  };
  const fresh = {
    recognized: true,
    rows: [{ fecha: "28/08/2026", posicion: "8" }]
  };

  assert.equal(wouldEraseStoredCollection(fresh, cached), true);
  assert.equal(wouldEraseStoredCollection(fresh, cached, { allowCollectionShrink: true }), false);
  assert.equal(wouldEraseStoredCollection({ recognized: true, rows: [] }, cached, { allowCollectionShrink: true }), false);
});

test("una SL reconocida reemplaza posiciones antiguas aunque la sincronización sea parcial", () => {
  assert.match(authoritativeSlMigration, /k = 'sl'[\s\S]*?recognized}' = 'true'[\s\S]*?jsonb_typeof[\s\S]*?= 'array'[\s\S]*?continue;/);
  assert.match(authoritativeSlMigration, /20\/09\/2026[\s\S]*?where chapa = '72683'/);
  assert.doesNotMatch(authoritativeSlMigration, /grant execute/);
});
