import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRequestedDoubles,
  currentMadridMonth,
  parseMessagesHtml,
  parsePayrollsHtml
} from "../scripts/portal-messages-doubles.js";

test("parseMessagesHtml reads the visible portal inbox without opening messages", () => {
  const parsed = parseMessagesHtml(`
    <h1>Consultas Mensajes</h1>
    <table>
      <tr><td>1</td><td>PREVENCIÓN APM<br>04/08/26 14:09 - CPEV, DEPARTAMENTO DE PREVENCIÓN. LEÍDO EL 04/08/26 14:26</td></tr>
      <tr><td>2</td><td>AVISO DE OPERATIVA<br>13/08/26 07:10 - CPEV, OPERACIONES.</td></tr>
    </table>
  `);

  assert.equal(parsed.recognized, true);
  assert.deepEqual(parsed.rows, [
    {
      id: "04/08/2026-14:09-PREVENCIÓN APM",
      title: "PREVENCIÓN APM",
      date: "04/08/2026",
      time: "14:09",
      sender: "CPEV, DEPARTAMENTO DE PREVENCIÓN",
      read: true,
      readAt: "04/08/26 14:26"
    },
    {
      id: "13/08/2026-07:10-AVISO DE OPERATIVA",
      title: "AVISO DE OPERATIVA",
      date: "13/08/2026",
      time: "07:10",
      sender: "CPEV, OPERACIONES",
      read: false,
      readAt: ""
    }
  ]);
});

test("parsePayrollsHtml reads the secure electronic payroll list", () => {
  const parsed = parsePayrollsHtml(`
    <h1>Consultas Nómina electrónica</h1>
    <button>CERRAR MODO SEGURO</button>
    <table>
      <tr><td>1</td><td>Mensual 07/26</td></tr>
      <tr><td>2</td><td>Anticipo 1-15 07/26</td></tr>
      <tr><td>3</td><td>Revisión salarial 06/26</td></tr>
    </table>
  `);

  assert.equal(parsed.recognized, true);
  assert.equal(parsed.locked, false);
  assert.deepEqual(parsed.rows.map(({ title, type, period }) => ({ title, type, period })), [
    { title: "Mensual 07/26", type: "Mensual", period: "07/26" },
    { title: "Anticipo 1-15 07/26", type: "Anticipo 1-15", period: "07/26" },
    { title: "Revisión salarial 06/26", type: "Revisión salarial", period: "06/26" }
  ]);
});

test("buildRequestedDoubles keeps only valid checked specialty and journey pairs", () => {
  assert.deepEqual(buildRequestedDoubles("16/8/2026", [
    { specialty: "- CONDUCTOR 1a", journey: "20/02", holiday: true },
    { specialty: "CONDUCTOR 2a", journey: "" }
  ]), [
    { date: "16/08/2026", specialty: "CONDUCTOR 1a", journey: "20/02", holiday: true }
  ]);
});

test("currentMadridMonth lists every date in the current Madrid month", () => {
  const month = currentMadridMonth(new Date("2026-08-13T05:30:00Z"));
  assert.equal(month.year, 2026);
  assert.equal(month.month, 8);
  assert.equal(month.dates.length, 31);
  assert.equal(month.dates[0], "01/08/2026");
  assert.equal(month.dates.at(-1), "31/08/2026");
});
