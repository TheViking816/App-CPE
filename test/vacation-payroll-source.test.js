import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVacationPayrollEntries,
  summarizeAnnualPayroll,
  vacationPayrollEntriesForMonth
} from "../src/payroll.js";

test("contabiliza en el Sueldómetro los periodos de la sección Vacaciones", () => {
  const entries = buildVacationPayrollEntries({
    rows: [{ inicio: "31/08/2026", fin: "31/08/2026", dias: 1 }]
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].payroll.date, "2026-08-31");
  assert.equal(entries[0].isVacation, true);
  assert.ok(entries[0].payroll.total > 0);
  assert.deepEqual(vacationPayrollEntriesForMonth(entries, "Agosto de 2026"), entries);
});

test("incluye rangos completos y evita duplicar días presentes también en Descansos", () => {
  const entries = buildVacationPayrollEntries([
    { rows: [{ inicio: "31/08/2026", fin: "02/09/2026", dias: 3 }] },
    { months: [{ month: 8, year: 2026, days: [{ day: 31, code: "VA" }] }] }
  ]);

  assert.deepEqual(entries.map((entry) => entry.payroll.date), [
    "2026-08-31", "2026-09-01", "2026-09-02"
  ]);
});

test("el resumen anual suma el importe y el día VA al mes correspondiente", () => {
  const entries = buildVacationPayrollEntries({
    rows: [{ inicio: "2026-08-31", fin: "2026-08-31", dias: 1 }]
  });
  const annual = summarizeAnnualPayroll([
    { year: 2026, month: 8, monthLabel: "Agosto de 2026", rows: [] }
  ], null, {}, entries);

  assert.equal(annual.months[0].vacationDays, 1);
  assert.equal(annual.months[0].total, entries[0].payroll.total);
});
