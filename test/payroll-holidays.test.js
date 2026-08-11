import test from "node:test";
import assert from "node:assert/strict";

import { enrichJornales } from "../src/payroll.js";

function calculate(day, jornada) {
  return enrichJornales([{
    dia: String(day),
    jornada,
    especialidad: "CONDUCTOR 1a",
    operacion: "CONT. C/SPREADER AUT"
  }], [], "Agosto de 2026")[0].payroll;
}

test("el 15 de agosto se paga como festivo", () => {
  const payroll = calculate(15, "DE 08 A 14 H.");

  assert.equal(payroll.rateKey, "FESTIVO");
  assert.equal(payroll.base, 189.98);
});

test("el 20-02 del 14 de agosto es laborable a festivo", () => {
  const payroll = calculate(14, "DE 20 A 02 H.");

  assert.equal(payroll.rateKey, "LABORABLE_TO_FESTIVO");
  assert.equal(payroll.base, 200.51);
});

test("el 02-08 del 16 de agosto es festivo a laborable", () => {
  const payroll = calculate(16, "DE 02 A 08 H.");

  assert.equal(payroll.rateKey, "FESTIVO_TO_LABORABLE");
  assert.equal(payroll.base, 261.16);
});
