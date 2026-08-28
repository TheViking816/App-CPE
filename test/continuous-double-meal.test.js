import test from "node:test";
import assert from "node:assert/strict";

import { CONTINUOUS_DOUBLE_MEAL_RATE, enrichJornales } from "../src/payroll.js";

function jornal(day, shift, part) {
  return {
    dia: String(day),
    parte: part,
    jornada: `DE ${shift.replace("-", " A ")} H.`,
    especialidad: "CONDUCTOR 1a",
    operacion: "CONT. C/SPREADER AUT"
  };
}

test("suma manutención de comida al segundo jornal 08-14 y 14-20", () => {
  const enriched = enrichJornales([
    jornal(13, "08-14", "100"),
    jornal(13, "14-20", "101")
  ], [], "Agosto de 2026");

  assert.equal(enriched[0].payroll.continuousDoubleMeal, 0);
  assert.equal(enriched[1].payroll.continuousDoubleMeal, CONTINUOUS_DOUBLE_MEAL_RATE);
  assert.equal(enriched[1].payroll.continuousDoubleMealType, "COMIDA");
  assert.equal(enriched[1].payroll.continuousDoubleMealHours, "14-15");
  assert.equal(enriched[1].payroll.total, 135.22);
});

test("suma manutención de cena al segundo jornal 14-20 y 20-02", () => {
  const enriched = enrichJornales([
    jornal(13, "14-20", "200"),
    jornal(13, "20-02", "201")
  ], [], "Agosto de 2026");

  assert.equal(enriched[0].payroll.continuousDoubleMeal, 0);
  assert.equal(enriched[1].payroll.continuousDoubleMeal, CONTINUOUS_DOUBLE_MEAL_RATE);
  assert.equal(enriched[1].payroll.continuousDoubleMealType, "CENA");
  assert.equal(enriched[1].payroll.continuousDoubleMealHours, "20-21");
  assert.equal(enriched[1].payroll.total, 188.05);
});

test("no suma manutención con jornadas no continuas o de días distintos", () => {
  const enriched = enrichJornales([
    jornal(13, "08-14", "300"),
    jornal(13, "20-02", "301"),
    jornal(14, "14-20", "302")
  ], [], "Agosto de 2026");

  assert.ok(enriched.every((item) => item.payroll.continuousDoubleMeal === 0));
});
