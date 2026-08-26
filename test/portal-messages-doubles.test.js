import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRequestedDoubles,
  cleanMessageBodyText,
  currentMadridMonth,
  extractAddedMessageText,
  limitRecentPortalRows,
  parseMessagesHtml,
  parsePayrollsHtml,
  prioritizePortalMonths,
  upcomingMadridDates
} from "../scripts/portal-messages-doubles.js";

test("prioritizePortalMonths checks the current month first and then recent history", () => {
  assert.deepEqual(prioritizePortalMonths([1, 2, 8, 7, 6], 8), [8, 7, 6, 2, 1]);
});

test("cleanMessageBodyText keeps the expanded message and removes portal metadata", () => {
  const body = cleanMessageBodyText(`
    24/02/26 9:02 - CPEV, Departamento de Recursos Humanos. Leído el 24/02/26 11:55
    RESPUESTA ADICIONAL SOLICITO E26/04619 (CARNÉ DE CAMIÓN)
    Tu solicitud ha sido revisada. Puedes consultar la respuesta adjunta.
    Eliminar
  `, {
    title: "RESPUESTA ADICIONAL SOLICITO E26/04619 (CARNÉ DE CAMIÓN)"
  });

  assert.equal(body, "Tu solicitud ha sido revisada. Puedes consultar la respuesta adjunta.");
});

test("extractAddedMessageText reads content rendered outside the message card", () => {
  const before = "MENSAJES\n24/02/26 9:02 - CPEV, Recursos Humanos\nRESPUESTA SOLICITUD\n";
  const after = `${before}La solicitud ha sido aceptada.\nEliminar\n`;
  assert.equal(
    extractAddedMessageText(before, after, { title: "RESPUESTA SOLICITUD" }),
    "La solicitud ha sido aceptada."
  );
});

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

test("limitRecentPortalRows keeps only the first five portal messages", () => {
  assert.deepEqual(limitRecentPortalRows([1, 2, 3, 4, 5, 6, 7]), [1, 2, 3, 4, 5]);
});

test("upcomingMadridDates returns seven calendar dates starting today", () => {
  const dates = upcomingMadridDates(new Date("2026-08-13T05:30:00Z"));
  assert.deepEqual(dates, [
    "13/08/2026", "14/08/2026", "15/08/2026", "16/08/2026",
    "17/08/2026", "18/08/2026", "19/08/2026"
  ]);
});

test("upcomingMadridDates crosses month and year boundaries", () => {
  assert.deepEqual(upcomingMadridDates(new Date("2026-08-28T10:00:00Z")), [
    "28/08/2026", "29/08/2026", "30/08/2026", "31/08/2026",
    "01/09/2026", "02/09/2026", "03/09/2026"
  ]);
  assert.deepEqual(upcomingMadridDates(new Date("2026-12-29T10:00:00Z")), [
    "29/12/2026", "30/12/2026", "31/12/2026", "01/01/2027",
    "02/01/2027", "03/01/2027", "04/01/2027"
  ]);
});
