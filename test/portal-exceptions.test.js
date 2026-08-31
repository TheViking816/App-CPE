import test from "node:test";
import assert from "node:assert/strict";
import { parseExceptions } from "../scripts/portal-exceptions.js";

test("lee la bolsa de excepciones y distingue las jornadas utilizadas", () => {
  const html = `
    <h1>BOLSA DE EXCEPCIONES</h1>
    <table>
      <tr><td>CHAPA</td><td>Trabajador</td><td>Fecha</td><td>Jornada</td><td>Pedida</td><td>Situacion</td><td>Utilizada</td></tr>
      <tr><td>72655</td><td>JOSE LUIS LOZANO GARCIA</td><td>20260309</td><td>DE 08 A 14 H.</td><td>20260301</td><td>Aceptada</td><td></td></tr>
      <tr><td>72655</td><td>JOSE LUIS LOZANO GARCIA</td><td>20260625</td><td>DE 14 A 20 H.</td><td>20260621</td><td>Aceptada</td><td><input type="checkbox" disabled checked="checked"></td></tr>
    </table>
    <p>De las Excepciones Voluntarias solicitadas ha usado un total de: 4</p>
    <p>Se pueden solicitar un total de 15 excepciones de jornada al año.</p>
  `;

  const result = parseExceptions(html);
  assert.equal(result.recognized, true);
  assert.equal(result.year, 2026);
  assert.equal(result.usedTotal, 4);
  assert.equal(result.maxAnnual, 15);
  assert.equal(result.remaining, 11);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].date, "2026-03-09");
  assert.equal(result.rows[1].used, true);
});

test("reconoce la sección aunque el trabajador todavía no tenga solicitudes", () => {
  const result = parseExceptions("<h1>Bolsa de Excepciones</h1><p>Excepciones solicitadas</p>");
  assert.equal(result.recognized, true);
  assert.equal(result.usedTotal, 0);
  assert.equal(result.remaining, 15);
  assert.deepEqual(result.rows, []);
});

test("no interpreta como lista vacía el título mostrado mientras carga el iframe", () => {
  const result = parseExceptions("<h1>Bolsa de Excepciones</h1>");
  assert.equal(result.recognized, false);
  assert.deepEqual(result.rows, []);
});
