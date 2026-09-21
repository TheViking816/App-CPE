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

test("el parte resuelto sustituye al C/A provisional de la misma anticipada", () => {
  const detail = { recognized: true, parte: "26394", specialties: [{ name: "TRASTAINERS RTT", requested: 10 }] };
  const common = {
    jornada: "DE 14 A 20 H.",
    especialidad: "TRASTAINERS RTT",
    empresa: "CSP IBERIAN VALENCIA TERMINAL",
    buque: "RTTS",
    operacion: "CONT. C/SPREADER AUT"
  };
  const snapshot = {
    payload: {
      asignaciones: { rows: [{ ...common, fecha: "14/09/2026", parte: "26394", detail }] },
      jornales: { monthLabel: "Septiembre de 2026", rows: [{ ...common, dia: "14", parte: "C/A" }] }
    }
  };

  const result = currentAssignmentsFromSnapshot(snapshot, new Date(2026, 8, 14, 9));
  assert.equal(result.length, 1);
  assert.equal(result[0].parte, "26394");
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

test("no muestra una asignacion de Donde voy que no figure en Jornales y Primas", () => {
  const snapshot = {
    payload: {
      asignaciones: {
        rows: [{ fecha: "23/09/2026", jornada: "DE 08 A 14 H.", parte: "27380", detail: { recognized: true } }]
      },
      jornales: {
        monthLabel: "Septiembre 2026",
        rows: [{ dia: "22", jornada: "DE 02 A 08 H.", parte: "27241" }]
      }
    }
  };

  const result = currentAssignmentsFromSnapshot(snapshot, new Date(2026, 8, 22, 9));
  assert.deepEqual(result.map((item) => item.parte), ["27241"]);
});
