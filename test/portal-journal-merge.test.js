import test from "node:test";
import assert from "node:assert/strict";

import { mergeAssignmentsIntoPortalJornales } from "../scripts/portal-journal-merge.js";

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
