import test from "node:test";
import assert from "node:assert/strict";
import {
  enrichJornales,
  getManualMovementPremium,
  mergeManualSalaryHistory,
  mergeManualSalaryJornales
} from "../src/payroll.js";

test("la prima usa solo los coeficientes de la tabla recibida y cambia al llegar a 120", () => {
  assert.deepEqual(getManualMovementPremium("2026-10-02", "08-14", 119), {
    amount: 45.70, rate: 0.384, dayType: "LABORABLE"
  });
  assert.deepEqual(getManualMovementPremium("2026-10-02", "08-14", 120), {
    amount: 75.48, rate: 0.629, dayType: "LABORABLE"
  });
  assert.equal(getManualMovementPremium("2026-10-02", "18-00", 120), null);
  assert.equal(getManualMovementPremium("2026-10-09", "14-20", 120)?.rate, 1.027);
});

test("el jornal manual se suma sin sustituir el cálculo base de App CPE", () => {
  const manual = [{ id: "m1", date: "2026-10-02", shift: "08-14", group: "II", operationType: "ESTIBA", premiumAmount: 75.48 }];
  const rows = mergeManualSalaryJornales([], manual, "10/2026");
  assert.equal(rows.length, 1);
  const payroll = enrichJornales(rows, [], "10/2026")[0].payroll;
  assert.equal(payroll.base, 105.53);
  assert.equal(payroll.prima, 75.48);
  assert.equal(payroll.total, 181.01);
});

test("la lectura posterior del portal reemplaza el manual del mismo día y turno", () => {
  const manual = [{ id: "m1", date: "2026-10-02", shift: "08-14", group: "II", operationType: "ESTIBA", premiumAmount: 75.48 }];
  const official = [{ dia: "02", jornada: "DE 08 A 14 H.", parte: "29320", jornal: "1", especialidad: "CONDUCTOR 1a", empresa: "CSP" }];
  const rows = mergeManualSalaryJornales(official, manual, "octubre de 2026");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].parte, "29320");
  assert.equal(rows[0].manualEntryId, "m1");
  const annual = mergeManualSalaryHistory([{ year: 2026, month: 10, monthLabel: "octubre de 2026", rows: official }], manual);
  assert.equal(annual[0].rows.length, 1);
});

test("jornales manuales de meses sin portal entran en el resumen anual", () => {
  const periods = mergeManualSalaryHistory([], [
    { id: "m1", date: "2026-09-29", shift: "08-14", group: "II", operationType: "ESTIBA" },
    { id: "m2", date: "2026-10-02", shift: "20-02", group: "II", operationType: "ESTIBA" }
  ]);
  assert.equal(periods.length, 2);
  assert.deepEqual(periods.map((period) => period.rows.length), [1, 1]);
});
