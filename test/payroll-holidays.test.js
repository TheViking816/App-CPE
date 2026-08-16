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

function calculateWithRelay(day, jornada) {
  const jornal = {
    dia: String(day),
    parte: `RELEVO-${day}-${jornada}`,
    jornada,
    especialidad: "CONDUCTOR 1a",
    operacion: "CONT. C/SPREADER AUT"
  };
  const preview = enrichJornales([jornal], [], "Agosto de 2026")[0].payroll;
  return enrichJornales([jornal], [], "Agosto de 2026", null, {
    [preview.relayHourKey]: true
  })[0].payroll;
}

test("la hora de relevo laborable suma 66,05 al total", () => {
  const base = calculate(10, "DE 08 A 14 H.");
  const monday = calculateWithRelay(10, "DE 08 A 14 H.");
  const saturdayMorning = calculateWithRelay(8, "DE 08 A 14 H.");
  const fridayAfternoon = calculateWithRelay(7, "DE 14 A 20 H.");

  for (const payroll of [monday, saturdayMorning, fridayAfternoon]) {
    assert.equal(payroll.relayHourEligible, true);
    assert.equal(payroll.relayHourRateKey, "LABORABLE");
    assert.equal(payroll.relayHour, 66.05);
  }
  assert.equal(monday.total, Number((base.total + 66.05).toFixed(2)));
});

test("la hora de relevo desde el sabado 14-20 y durante el domingo suma 96,08", () => {
  for (const [day, shift] of [[8, "DE 14 A 20 H."], [9, "DE 08 A 14 H."], [9, "DE 14 A 20 H."]]) {
    const payroll = calculateWithRelay(day, shift);
    assert.equal(payroll.relayHourRateKey, "FESTIVO");
    assert.equal(payroll.relayHour, 96.08);
  }
});

test("las jornadas 02-08 y 20-02 nunca admiten hora de relevo", () => {
  for (const shift of ["DE 02 A 08 H.", "DE 20 A 02 H."]) {
    const payroll = calculateWithRelay(9, shift);
    assert.equal(payroll.relayHourEligible, false);
    assert.equal(payroll.relayHour, 0);
  }
});

test("una hora de relevo en festivo oficial usa tarifa festiva", () => {
  const jornal = {
    dia: "15",
    parte: "RELEVO-FESTIVO",
    jornada: "DE 08 A 14 H.",
    especialidad: "CONDUCTOR 1a",
    operacion: "CONT. C/SPREADER AUT"
  };
  const config = {
    holidays: [{ holiday_date: "2026-08-15", enabled: true }],
    rates: [],
    complements: []
  };
  const preview = enrichJornales([jornal], [], "Agosto de 2026", config)[0].payroll;
  const payroll = enrichJornales([jornal], [], "Agosto de 2026", config, {
    [preview.relayHourKey]: true
  })[0].payroll;

  assert.equal(payroll.relayHourRateKey, "FESTIVO");
  assert.equal(payroll.relayHour, 96.08);
});

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

test("el 02-08 del lunes tras domingo es festivo a laborable", () => {
  const payroll = calculate(10, "DE 02 A 08 H.");

  assert.equal(payroll.rateKey, "FESTIVO_TO_LABORABLE");
  assert.equal(payroll.base, 261.16);
  assert.equal(payroll.complement, 7.38);
  assert.equal(payroll.total, 268.54);
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

test("trastainer suma jornal, complemento de servicio publico y prima", () => {
  const payroll = enrichJornales([{
    dia: "13",
    parte: "30001",
    jornada: "DE 08 A 14 H.",
    especialidad: "TRASTAINERS RTT",
    operacion: "CONT. C/SPREADER AUT",
    produccion: "120,50 EUR"
  }], [], "Agosto de 2026")[0].payroll;

  assert.equal(payroll.base, 105.53);
  assert.equal(payroll.complement, 60.57);
  assert.equal(payroll.prima, 120.50);
  assert.equal(payroll.total, 286.60);
});

test("containera suma complemento y prima tambien en recepcion y entrega", () => {
  const payroll = enrichJornales([{
    dia: "13",
    parte: "30002",
    jornada: "DE 20 A 02 H.",
    especialidad: "CONTAINERA",
    operacion: "RECEPCION / ENTREGA",
    produccion: "90,00 EUR"
  }], [], "Agosto de 2026")[0].payroll;

  assert.equal(payroll.base, 227.93);
  assert.equal(payroll.complement, 16.90);
  assert.equal(payroll.prima, 90);
  assert.equal(payroll.total, 334.83);
  assert.equal(payroll.primaPending, false);
});

test("gruas usa el complemento festivo y suma la prima del portal", () => {
  const payroll = enrichJornales([{
    dia: "15",
    parte: "30003",
    jornada: "DE 14 A 20 H.",
    especialidad: "GRUAS",
    operacion: "CONT. C/SPREADER AUT",
    produccion: "75,25 EUR"
  }], [], "Agosto de 2026")[0].payroll;

  assert.equal(payroll.rateKey, "FESTIVO");
  assert.equal(payroll.complement, 70.26);
  assert.equal(payroll.prima, 75.25);
  assert.equal(payroll.total, 414.56);
});

test("los complementos de manipuladores se pueden modificar desde la tabla de especialidades", () => {
  const payroll = enrichJornales([{
    dia: "13",
    parte: "30004",
    jornada: "DE 08 A 14 H.",
    especialidad: "TRASTAINERS RTT",
    operacion: "CONT. C/SPREADER AUT",
    produccion: "100,00 EUR"
  }], [], "Agosto de 2026", {
    complements: [{
      specialty_key: "TRASTAINERS_RTT",
      amount: null,
      servicio_publico_08_14: "65.00"
    }]
  })[0].payroll;

  assert.equal(payroll.complement, 65);
  assert.equal(payroll.total, 270.53);
});

test("mantiene editables los complementos simples existentes en Supabase", () => {
  const payroll = enrichJornales([{
    dia: "13",
    parte: "30005",
    jornada: "DE 08 A 14 H.",
    especialidad: "CONDUCTOR 1a",
    operacion: "CONT. C/SPREADER AUT"
  }], [], "Agosto de 2026", {
    complements: [{
      specialty_key: "CONDUCTOR_1A",
      amount: "8.25"
    }]
  })[0].payroll;

  assert.equal(payroll.complement, 8.25);
  assert.equal(payroll.total, 113.78);
});

test("aplica los complementos de puesto 2026 a las demas especialidades", () => {
  const cases = [
    ["CAPATAZ", 86.48],
    ["SOBORDISTA", 74.89],
    ["TRINCADOR", 48.21],
    ["CLASIFICADOR", 74.89],
    ["MAFIS", 74.89],
    ["MANIPULADOR OP. UNICA", 56.96],
    ["APOYO OPERACION", 113.92],
    ["GARAJISTA RO-RO", 181.41],
    ["FURGONETERO RO-RO", 47.47],
    ["CONDUCTOR DE 2A RORO", 6.94]
  ];

  for (const [especialidad, expected] of cases) {
    const payroll = enrichJornales([{
      dia: "13",
      jornada: "DE 08 A 14 H.",
      especialidad,
      operacion: "CONT. C/SPREADER AUT"
    }], [], "Agosto de 2026")[0].payroll;

    assert.equal(payroll.complement, expected, especialidad);
  }
});

test("los nuevos complementos siguen siendo editables desde Supabase", () => {
  const payroll = enrichJornales([{
    dia: "13",
    jornada: "DE 08 A 14 H.",
    especialidad: "APOYO OPERACION",
    operacion: "CONT. C/SPREADER AUT"
  }], [], "Agosto de 2026", {
    complements: [{ specialty_key: "APOYO_OPERACION", amount: "120.50" }]
  })[0].payroll;

  assert.equal(payroll.complement, 120.50);
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
