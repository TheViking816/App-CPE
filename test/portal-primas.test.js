import test from "node:test";
import assert from "node:assert/strict";

import { parsePrimas } from "../scripts/sync-portal-oficial.js";
import { enrichJornales } from "../src/payroll.js";

const html = `
  <p>Jornales de Agosto de 2026</p>
  <table>
    <tr><th>Jornal</th><th>Parte</th><th>Dia</th><th>Tipo</th><th>Jornada</th><th>Especialidad</th><th>Empresa</th><th>Buque</th><th>Operacion</th><th>Produccion</th></tr>
    <tr><td>1</td><td>23045</td><td>13</td><td>TUR</td><td>DE 02 A 08 H.</td><td>CONDUCTOR 1a</td><td>APM</td><td>MAERSK</td><td>CONT. C/SPREADER AUT</td><td><font color="green">135.08 EUR</font></td></tr>
    <tr><td>2</td><td>23046</td><td>14</td><td>TUR</td><td>DE 02 A 08 H.</td><td>CONDUCTOR 1a</td><td>MSC</td><td>MSC ARICA</td><td>CONT. C/SPREADER AUT</td><td style="color: rgb(255, 0, 0)">153.51 EUR</td></tr>
  </table>`;

test("conserva si la prima esta verificada o pendiente de verificar", () => {
  const parsed = parsePrimas(html);

  assert.equal(parsed.rows[0].produccionEstado, "verified");
  assert.equal(parsed.rows[1].produccionEstado, "pending");
});

test("propaga el estado de verificacion al calculo del jornal", () => {
  const primas = parsePrimas(html).rows;
  const [verified, pending] = enrichJornales(primas, primas, "Agosto de 2026");

  assert.equal(verified.payroll.prima, 135.08);
  assert.equal(verified.payroll.primaVerification, "verified");
  assert.equal(pending.payroll.prima, 153.51);
  assert.equal(pending.payroll.primaVerification, "pending");
});
