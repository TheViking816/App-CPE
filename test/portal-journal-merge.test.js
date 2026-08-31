import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { mergeAssignmentsIntoPortalJornales } from "../scripts/portal-journal-merge.js";

const syncSource = fs.readFileSync(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");

test("prioriza la vista actual de Jornadas contratadas", () => {
  assert.match(syncSource, /User,ViewContractings,,1/);
  assert.match(syncSource, /collectAssignmentsViaContractings/);
  assert.match(syncSource, /Jornadas contratadas/);
});

test("el snapshot guarda el proximo jornal confirmado tambien en jornales.rows", () => {
  const result = mergeAssignmentsIntoPortalJornales({
    recognized: true,
    year: 2026,
    monthLabel: "Agosto de 2026",
    rows: [{ dia: "19", parte: "23568", jornada: "DE 02 A 08 H." }],
    history: [{ year: 2026, month: 8, rows: [{ dia: "19", parte: "23568", jornada: "DE 02 A 08 H." }] }]
  }, {
    rows: [{ fecha: "20/08/2026", parte: "23683", jornada: "DE 02 A 08 H.", especialidad: "CONDUCTOR 1a" }]
  }, new Date(2026, 7, 19));

  assert.deepEqual(result.rows.map((row) => row.dia), ["19", "20"]);
  assert.equal(result.history[0].rows.length, 2);
  assert.equal(result.rows[1].upcomingAssignment, true);
});

test("no duplica una asignacion ya publicada como jornal", () => {
  const result = mergeAssignmentsIntoPortalJornales({
    year: 2026,
    monthLabel: "Agosto de 2026",
    rows: [{ dia: "20", parte: "C/A", jornada: "DE 14 A 20 H." }]
  }, {
    rows: [{ fecha: "20/08/2026", parte: "CONTRATACIÓN ANTICIPADA", jornada: "DE 14 A 20 H." }]
  }, new Date(2026, 7, 19));

  assert.equal(result.rows.length, 1);
});

test("promueve el mes siguiente al Sueldometro y conserva el anterior en el historico", () => {
  const result = mergeAssignmentsIntoPortalJornales({
    recognized: true,
    year: 2026,
    month: 8,
    monthLabel: "Agosto de 2026",
    rows: [{ dia: "30", parte: "24781", jornada: "DE 14 A 20 H." }],
    history: [{ year: 2026, month: 8, monthLabel: "Agosto de 2026", rows: [{ dia: "30", parte: "24781", jornada: "DE 14 A 20 H." }] }]
  }, {
    rows: [{ fecha: "01/09/2026", parte: "24943", jornada: "DE 02 A 08 H.", especialidad: "CONDUCTOR 1a" }]
  }, new Date(2026, 7, 31));

  assert.equal(result.monthLabel, "Septiembre de 2026");
  assert.equal(result.month, 9);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].parte, "24943");
  assert.deepEqual(result.history.map((period) => period.month), [8, 9]);
  assert.equal(result.history[0].rows[0].parte, "24781");
});
