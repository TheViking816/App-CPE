import assert from "node:assert/strict";
import test from "node:test";
import { parseSl, wouldEraseStoredCollection } from "../scripts/sync-portal-oficial.js";

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
