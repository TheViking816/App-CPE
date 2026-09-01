import test from "node:test";
import assert from "node:assert/strict";
import { currentAssignmentsFromSnapshot } from "../src/currentAssignments.js";

test("muestra el jornal actual aunque Donde voy conserve asignaciones antiguas", () => {
  const snapshot = {
    payload: {
      asignaciones: { rows: [{ fecha: "24/08/2026", jornada: "DE 20 A 02 H.", parte: "ANTIGUO" }] },
      jornales: {
        monthLabel: "Agosto de 2026",
        rows: [{ dia: "29", jornada: "DE 08 A 14 H.", parte: "24673", especialidad: "TRINCADOR" }]
      }
    }
  };

  const result = currentAssignmentsFromSnapshot(snapshot, new Date(2026, 7, 29, 9));
  assert.equal(result.length, 1);
  assert.equal(result[0].parte, "24673");
  assert.equal(result[0].fecha, "29/08/2026");
});

test("el parte completo gana al jornal basico cuando ambos coinciden", () => {
  const detail = { recognized: true, specialties: [{ name: "TRINCADOR", requested: 1 }] };
  const snapshot = {
    payload: {
      asignaciones: { rows: [{ fecha: "29/08/2026", jornada: "DE 08 A 14 H.", parte: "24673", detail }] },
      jornales: { monthLabel: "Agosto de 2026", rows: [{ dia: "29", jornada: "DE 08 A 14 H.", parte: "24673" }] }
    }
  };

  const result = currentAssignmentsFromSnapshot(snapshot, new Date(2026, 7, 29, 9));
  assert.equal(result.length, 1);
  assert.equal(result[0].detail, detail);
});

test("Contratacion muestra una sola reserva de grupo III como clasificador", () => {
  const snapshot = {
    payload: {
      asignaciones: { rows: [{ fecha: "01/09/2026", jornada: "DE 20 A 02 H.", parte: "RESERVA", operacion: "RESERVA III y IV" }] },
      jornales: {
        monthLabel: "Septiembre de 2026",
        rows: [{ dia: "01", jornada: "DE 20 A 02 H.", parte: "C/A", operacion: "RESERVA III y IV", especialidad: "RESERVA G III" }]
      }
    }
  };

  const result = currentAssignmentsFromSnapshot(snapshot, new Date(2026, 8, 1, 9));
  assert.equal(result.length, 1);
  assert.equal(result[0].especialidad, "CLASIFICADOR");
  assert.equal(result[0].payrollGroup, "III");
});
