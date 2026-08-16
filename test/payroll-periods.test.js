import test from "node:test";
import assert from "node:assert/strict";

import { filterJornalesByPeriod, summarizePayroll } from "../src/payroll.js";

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

test("calcula lo ganado en cada quincena y en el mes completo", () => {
  const summary = summarizePayroll(rows);

  assert.equal(summary.firstHalf, 250);
  assert.equal(summary.secondHalf, 470);
  assert.equal(summary.total, 720);
});
