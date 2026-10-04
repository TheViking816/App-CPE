import assert from "node:assert/strict";
import test from "node:test";
import { mapNorayDoublesMonth, readNorayDoublesModalDom } from "../scripts/portal-noray-doubles-dom.js";

function octoberCalendar() {
  return {
    monthLabel: "Octubre 2026", month: 10, year: 2026,
    days: Array.from({ length: 31 }, (_, index) => ({
      day: index + 1, code: "", status: "", badges: []
    }))
  };
}

test("reads green doubles and yellow meal/dinner relay hours from the current month", () => {
  const calendar = octoberCalendar();
  calendar.days[8].badges = [{ title: "20 A 02 H.", count: 1 }];
  calendar.days[9].badges = [{ title: "Cena", count: 1 }];
  calendar.days[10].badges = [
    { title: "20 A 02 H.", count: 1 },
    { title: "Comida", count: 1 },
    { title: "Cena", count: 1 }
  ];
  calendar.days[12].code = "DS";
  calendar.days[22].code = "SL";
  const result = mapNorayDoublesMonth(calendar, [
    { recognized: true, date: "09/10/2026", rows: [{ specialty: "CONDUCTOR 1a", journey: "20/02" }], relay: { meal: false, dinner: false } },
    { recognized: true, date: "10/10/2026", rows: [], relay: { meal: false, dinner: true } },
    { recognized: true, date: "11/10/2026", rows: [{ specialty: "CONDUCTOR 1a", journey: "20/02" }], relay: { meal: true, dinner: true } }
  ]);

  assert.equal(result.complete, true);
  assert.equal(result.windowDays, 31);
  assert.equal(result.startDate, "01/10/2026");
  assert.equal(result.endDate, "31/10/2026");
  assert.deepEqual(result.rows.map(({ date, specialty, journey }) => [date, specialty, journey]), [
    ["09/10/2026", "CONDUCTOR 1a", "20/02"],
    ["11/10/2026", "CONDUCTOR 1a", "20/02"]
  ]);
  assert.deepEqual(result.relayHours.map(({ date, period, journey }) => [date, period, journey]), [
    ["10/10/2026", "Cena", "20/21"],
    ["11/10/2026", "Comida", "14/15"],
    ["11/10/2026", "Cena", "20/21"]
  ]);
  assert.deepEqual(result.calendarDays.filter(({ code }) => code).map(({ date, code }) => [date, code]), [
    ["13/10/2026", "DS"], ["23/10/2026", "SL"]
  ]);
});

test("does not overwrite saved dobles when a day or modal is incomplete", () => {
  const calendar = octoberCalendar();
  calendar.days[3].badges = [{ title: "20 A 02 H.", count: 1 }];
  assert.throws(() => mapNorayDoublesMonth(calendar, []), /detalle incompleto/);
  calendar.days.pop();
  assert.throws(() => mapNorayDoublesMonth(calendar, []), /calendario de dobles incompleto/i);
});

test("normalizes a single-digit modal date before matching its calendar day", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelectorAll(selector) {
      if (selector === "h3") return [{ textContent: "Dobles - 4/10/2026" }];
      if (selector === "table") return [];
      return [];
    }
  };
  try {
    assert.equal(readNorayDoublesModalDom().date, "04/10/2026");
  } finally {
    globalThis.document = previousDocument;
  }
});
