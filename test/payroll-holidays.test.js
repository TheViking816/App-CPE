import test from "node:test";
import assert from "node:assert/strict";

import { enrichJornales, summarizeAnnualPayroll } from "../src/payroll.js";

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

test("el 02-08 del domingo 16 de agosto es festivo a festivo", () => {
  const payroll = calculate(16, "DE 02 A 08 H.");

  assert.equal(payroll.rateKey, "FESTIVO_TO_FESTIVO");
  assert.equal(payroll.base, 438.26);
});

test("el 20-02 del festivo 15 hacia el domingo es festivo a festivo", () => {
  const payroll = calculate(15, "DE 20 A 02 H.");

  assert.equal(payroll.rateKey, "FESTIVO_TO_FESTIVO");
  assert.equal(payroll.base, 362.16);
});

test("el 20-02 del domingo 16 hacia el lunes es festivo a laborable", () => {
  const payroll = calculate(16, "DE 20 A 02 H.");

  assert.equal(payroll.rateKey, "FESTIVO_TO_LABORABLE");
  assert.equal(payroll.base, 320.77);
});

test("los festivos configurados sustituyen el calendario local", () => {
  const payroll = enrichJornales([{
    dia: "13",
    jornada: "DE 20 A 02 H.",
    especialidad: "CONDUCTOR 1a",
    operacion: "CONT. C/SPREADER AUT"
  }], [], "Agosto de 2026", {
    holidays: [{ holiday_date: "2026-08-14", enabled: true }],
    rates: [],
    complements: []
  })[0].payroll;

  assert.equal(payroll.rateKey, "LABORABLE_TO_FESTIVO");
  assert.equal(payroll.base, 200.51);
});

test("no suma dos veces una prima presente en jornales y primas", () => {
  const payroll = enrichJornales([{
    dia: "09",
    parte: "22585",
    jornada: "DE 20 A 02 H.",
    especialidad: "CONDUCTOR 1a",
    operacion: "CONT. C/SPREADER AUT",
    produccion: "202,54 EUR"
  }], [{
    parte: "22585",
    produccion: "202,54 EUR"
  }], "Agosto de 2026")[0].payroll;

  assert.equal(payroll.base, 320.77);
  assert.equal(payroll.complement, 7.38);
  assert.equal(payroll.prima, 202.54);
  assert.equal(payroll.total, 530.69);
});

test("el total anual usa las primas incluidas en cada mes sin mezclarlas", () => {
  const annual = summarizeAnnualPayroll([
    {
      year: 2026,
      month: 1,
      monthLabel: "Enero de 2026",
      rows: [{
        dia: "10",
        parte: "100",
        jornada: "DE 08 A 14 H.",
        especialidad: "CONDUCTOR 1a",
        operacion: "CONT. C/SPREADER AUT",
        produccion: "50,00 EUR"
      }]
    },
    {
      year: 2026,
      month: 2,
      monthLabel: "Febrero de 2026",
      rows: [{
        dia: "10",
        parte: "100",
        jornada: "DE 08 A 14 H.",
        especialidad: "CONDUCTOR 1a",
        operacion: "CONT. C/SPREADER AUT",
        produccion: "75,00 EUR"
      }]
    }
  ]);

  assert.equal(annual.count, 2);
  assert.equal(annual.primaTotal, 125);
  assert.equal(annual.months[0].primaTotal, 50);
  assert.equal(annual.months[1].primaTotal, 75);
  assert.equal(annual.total, 367.31);
});
