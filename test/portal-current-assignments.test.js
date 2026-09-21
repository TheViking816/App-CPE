import test from "node:test";
import assert from "node:assert/strict";
import { assignmentsFromCurrentJournals } from "../scripts/portal-current-assignments.js";

test("prepara el parte actual para leer su equipo aunque Donde voy quede antiguo", () => {
  const journals = {
    monthLabel: "Agosto de 2026",
    rows: [
      { dia: "29", parte: "24673", jornada: "DE 08 A 14 H.", especialidad: "TRINCADOR" },
      { dia: "29", parte: "24673", jornada: "DE 08 A 14 H.", especialidad: "TRINCADOR" }
    ]
  };
  const assignments = { rows: [{ fecha: "24/08/2026", parte: "ANTIGUO", jornada: "DE 20 A 02 H." }] };

  const result = assignmentsFromCurrentJournals(journals, assignments, new Date(2026, 7, 29, 9));
  assert.deepEqual(result.map(({ fecha, parte }) => ({ fecha, parte })), [{ fecha: "29/08/2026", parte: "24673" }]);
});

test("prepara solo los partes de hoy y posteriores de Jornales y Primas", () => {
  const journals = {
    monthLabel: "Septiembre 2026",
    rows: [
      { dia: "21", parte: "27199", jornada: "14-20" },
      { dia: "22", parte: "27241", jornada: "02-08" },
      { dia: "23", parte: "27380", jornada: "08-14" }
    ]
  };

  const result = assignmentsFromCurrentJournals(journals, { rows: [] }, new Date(2026, 8, 22, 9));
  assert.deepEqual(result.map(({ fecha, parte }) => ({ fecha, parte })), [
    { fecha: "22/09/2026", parte: "27241" },
    { fecha: "23/09/2026", parte: "27380" }
  ]);
});

test("no vuelve a leer un parte que Donde voy ya entrego completo", () => {
  const journals = { monthLabel: "Agosto de 2026", rows: [{ dia: "29", parte: "24673", jornada: "08-14" }] };
  const assignments = { rows: [{ fecha: "29/08/2026", parte: "24673", jornada: "DE 08 A 14 H.", detail: { recognized: true } }] };
  assert.deepEqual(assignmentsFromCurrentJournals(journals, assignments, new Date(2026, 7, 29, 9)), []);
});

test("no añade como segundo parte la reserva III y IV ya presente en Donde voy", () => {
  const journals = {
    monthLabel: "Septiembre de 2026",
    rows: [{ dia: "01", parte: "C/A", jornada: "DE 20 A 02 H.", operacion: "RESERVA III y IV", especialidad: "RESERVA G III" }]
  };
  const assignments = {
    rows: [{ fecha: "01/09/2026", parte: "RESERVA", jornada: "DE 20 A 02 H.", operacion: "RESERVA III y IV" }]
  };

  assert.deepEqual(assignmentsFromCurrentJournals(journals, assignments, new Date(2026, 8, 1, 9)), []);
});
