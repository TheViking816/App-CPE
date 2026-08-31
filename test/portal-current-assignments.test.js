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

test("no vuelve a leer un parte que Donde voy ya entrego completo", () => {
  const journals = { monthLabel: "Agosto de 2026", rows: [{ dia: "29", parte: "24673", jornada: "08-14" }] };
  const assignments = { rows: [{ fecha: "29/08/2026", parte: "24673", jornada: "DE 08 A 14 H.", detail: { recognized: true } }] };
  assert.deepEqual(assignmentsFromCurrentJournals(journals, assignments, new Date(2026, 7, 29, 9)), []);
});
