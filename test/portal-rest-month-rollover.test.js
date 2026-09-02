import assert from "node:assert/strict";
import test from "node:test";
import {
  hasCurrentRestMonthWindow,
  parseDescansos,
  restMonthWindow,
  selectCurrentRestMonths
} from "../scripts/sync-portal-oficial.js";

function restLink(year, month, day, code = "DS") {
  return `<a href="javascript:selFecha(${year},${month},${day})">${code}</a>`;
}

test("al cambiar de agosto a septiembre publica septiembre y octubre", () => {
  const now = new Date("2026-09-02T00:30:00.000Z");
  const parsed = parseDescansos([
    restLink(2026, 8, 31),
    restLink(2026, 9, 1),
    restLink(2026, 10, 2)
  ].join(""), now);

  assert.deepEqual(parsed.months.map(({ year, month }) => [year, month]), [
    [2026, 9],
    [2026, 10]
  ]);
  assert.equal(hasCurrentRestMonthWindow(parsed, now), true);
});

test("no acepta como completa una lectura antigua de agosto y septiembre", () => {
  const now = new Date("2026-09-02T00:30:00.000Z");
  const months = [
    { year: 2026, month: 8 },
    { year: 2026, month: 9 }
  ];

  assert.deepEqual(selectCurrentRestMonths(months, now), [{ year: 2026, month: 9 }]);
  assert.equal(hasCurrentRestMonthWindow({ months }, now), false);
});

test("el siguiente mes cruza correctamente de diciembre a enero", () => {
  const now = new Date("2026-12-15T12:00:00.000Z");
  assert.deepEqual(restMonthWindow(now), [
    { year: 2026, month: 12 },
    { year: 2027, month: 1 }
  ]);
});
