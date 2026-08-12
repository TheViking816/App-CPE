import assert from "node:assert/strict";
import test from "node:test";
import { parseSl } from "../scripts/sync-portal-oficial.js";

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
