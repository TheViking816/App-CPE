import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVacationPayrollEntries,
  filterJornalesByPeriod,
  mergeUpcomingAssignmentsIntoJornales,
  selectPortalJornales,
  selectPortalJornalesHistory,
  summarizeAnnualPayroll,
  summarizePayroll,
  VACATION_DAY_RATE,
  vacationPayrollEntriesForMonth
} from "../src/payroll.js";

const rows = [
  { dia: "01", payroll: { total: 100 } },
  { dia: "15", payroll: { total: 150 } },
  { dia: "16", payroll: { total: 160 } },
  { dia: "31", payroll: { total: 310 } }
];

test("separa los jornales mensuales por quincenas", () => {
  assert.deepEqual(filterJornalesByPeriod(rows, "first").map((item) => item.dia), ["01", "15"]);
  assert.deepEqual(filterJornalesByPeriod(rows, "second").map((item) => item.dia), ["16", "31"]);
  assert.equal(filterJornalesByPeriod(rows, "month").length, 4);
});

test("prioriza los jornales completos frente a primas incompletas", () => {
  const portalRows = [
    { dia: "14", parte: "23070" },
    { dia: "17", parte: "23400" },
    { dia: "18", parte: "23485" }
  ];
  const premiumRows = [{ dia: "14", parte: "23070", produccion: "12,50" }];
  const selected = selectPortalJornales(
    { recognized: true, rows: portalRows, history: [{ month: 8, rows: portalRows }] },
    { recognized: true, rows: premiumRows, history: [{ month: 8, rows: premiumRows }] }
  );

  assert.deepEqual(filterJornalesByPeriod(selected, "second").map((item) => item.dia), ["17", "18"]);
  assert.equal(selectPortalJornalesHistory(
    { history: [{ month: 8, rows: portalRows }] },
    { history: [{ month: 8, rows: premiumRows }] }
  )[0].rows.length, 3);
});

test("calcula lo ganado en cada quincena y en el mes completo", () => {
  const summary = summarizePayroll(rows);

  assert.equal(summary.firstHalf, 250);
  assert.equal(summary.secondHalf, 470);
  assert.equal(summary.total, 720);
});

test("convierte los dias VA del calendario en conceptos salariales", () => {
  const entries = buildVacationPayrollEntries({
    months: [{
      title: "8/2026",
      year: 2026,
      month: 8,
      days: [
        { day: 11, code: "VA" },
        { day: 20, code: "VA" },
        { day: 21, code: "DS" },
        { day: 11, code: "VA" }
      ]
    }]
  });

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((item) => item.payroll.date), ["2026-08-11", "2026-08-20"]);
  assert.ok(entries.every((item) => item.payroll.total === VACATION_DAY_RATE));
  assert.equal(vacationPayrollEntriesForMonth(entries, "Agosto de 2026").length, 2);
});

test("suma vacaciones en su quincena sin contarlas como jornales", () => {
  const vacationRows = buildVacationPayrollEntries({
    months: [{
      title: "8/2026",
      days: [{ day: 11, code: "VA" }, { day: 20, code: "VA" }]
    }]
  });
  const summary = summarizePayroll([...rows, ...vacationRows]);

  assert.equal(summary.workCount, 4);
  assert.equal(summary.vacationDays, 2);
  assert.equal(summary.firstHalf, 464.11);
  assert.equal(summary.secondHalf, 684.11);
  assert.equal(summary.total, 1148.22);
});

test("incluye meses con solo vacaciones en el resumen anual", () => {
  const vacationRows = buildVacationPayrollEntries({
    months: [{
      title: "8/2026",
      days: [{ day: 11, code: "VA" }, { day: 20, code: "VA" }]
    }]
  });
  const annual = summarizeAnnualPayroll([], null, {}, vacationRows);

  assert.equal(annual.count, 0);
  assert.equal(annual.vacationDays, 2);
  assert.equal(annual.total, 428.22);
  assert.equal(annual.activeMonths, 1);
  assert.equal(annual.months[0].total, 428.22);
});

test("incluye en el Sueldometro un jornal futuro ya confirmado en asignaciones", () => {
  const merged = mergeUpcomingAssignmentsIntoJornales(
    [{ dia: "19", parte: "23568", jornada: "DE 02 A 08 H." }],
    [{
      fecha: "20/08/2026",
      parte: "23683",
      jornada: "DE 02 A 08 H.",
      especialidad: "CONDUCTOR 1a",
      empresa: "MEDITERRANEAN SHIPPING C. TV",
      buque: "MSC MELINE",
      operacion: "CONT. C/SPREADER AUT"
    }],
    "Agosto de 2026",
    new Date(2026, 7, 19)
  );

  assert.deepEqual(merged.map((item) => item.dia), ["19", "20"]);
  assert.equal(merged[1].upcomingAssignment, true);
  assert.equal(filterJornalesByPeriod(merged, "second").length, 2);
});

test("no duplica el jornal cuando el portal ya lo ha publicado", () => {
  const merged = mergeUpcomingAssignmentsIntoJornales(
    [{ dia: "20", parte: "C/A", jornada: "DE 14 A 20 H." }],
    [{ fecha: "20/08/2026", parte: "CONTRATACIÓN ANTICIPADA", jornada: "DE 14 A 20 H." }],
    "Agosto de 2026",
    new Date(2026, 7, 19)
  );

  assert.equal(merged.length, 1);
});

test("el resumen anual cruza cada mes de jornales con su historico de primas", () => {
  const journalHistory = [{
    year: 2026,
    month: 7,
    monthLabel: "Julio de 2026",
    rows: [{
      dia: "10",
      parte: "18450",
      jornada: "DE 02 A 08 H.",
      especialidad: "CONDUCTOR 1a",
      operacion: "CONT. C/SPREADER AUT"
    }]
  }];
  const premiumHistory = [{
    year: 2026,
    month: 7,
    monthLabel: "Julio de 2026",
    rows: [{ parte: "18450", produccion: "193.24 €", produccionEstado: "paid" }]
  }];

  const annual = summarizeAnnualPayroll(journalHistory, null, {}, [], premiumHistory);

  assert.equal(annual.months[0].enriched[0].payroll.prima, 193.24);
  assert.equal(annual.months[0].enriched[0].payroll.primaVerification, "paid");
  assert.equal(annual.months[0].primaTotal, 193.24);
  assert.equal(annual.primaTotal, 193.24);
});
