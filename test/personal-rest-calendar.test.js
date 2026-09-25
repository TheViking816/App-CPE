import test from "node:test";
import assert from "node:assert/strict";
import { buildPersonalRestMonths, companyRestType, parseRestGroup } from "../src/restCalendar.js";

test("A-V shows every DS in blue, including group weekends, and common holidays separately", () => {
  const group = parseRestGroup("A - V");
  assert.equal(companyRestType(2026, 9, 24, group), "rest");
  assert.equal(companyRestType(2026, 9, 29, group), "rest");
  assert.equal(companyRestType(2026, 9, 23, group), "");
  assert.equal(companyRestType(2026, 10, 3, group), "rest");
  assert.equal(companyRestType(2026, 11, 1, group), "rest");
  assert.equal(companyRestType(2026, 10, 10, group), "");
  assert.equal(companyRestType(2026, 12, 25, group), "holiday");
  assert.equal(companyRestType(2026, 12, 2, group), "");
});

test("personal portal days win in the current month, vacations overlay rests, and past months are hidden", () => {
  const months = buildPersonalRestMonths(
    { worker: { group: "A-V" }, months: [
      { year: 2026, month: 8, days: [{ day: 3, code: "FM" }] },
      { year: 2026, month: 9, days: [{ day: 23, code: "DS" }, { day: 24, code: "SL" }] }
    ] },
    { rows: [{ inicio: "23/09/2026", fin: "24/09/2026" }] },
    new Date(2026, 8, 22)
  );
  const september = months.find((month) => month.key === "2026-09");
  assert.equal(months.some((month) => month.key === "2026-08"), false);
  assert.equal(september.days[22].type, "rest");
  assert.equal(september.days[22].vacation, true);
  assert.equal(september.days[23].type, "requested");
  assert.equal(september.days[23].vacation, true);
  assert.equal(months.find((month) => month.key === "2026-10").days[2].type, "rest");
  assert.equal(months.find((month) => month.key === "2026-10").days[2].code, "DS");
});

test("a blank portal day overrides a green company weekend and FS differs from DS", () => {
  const months = buildPersonalRestMonths(
    { worker: { group: "A-V" }, months: [{ year: 2026, month: 10, days: [
      { day: 9, code: "DS" }, { day: 17, code: "FS" }, { day: 18, code: "" }
    ] }] },
    null,
    new Date(2026, 8, 22)
  );
  const october = months.find((month) => month.key === "2026-10");
  assert.equal(october.days[8].type, "rest");
  assert.equal(october.days[16].type, "festive");
  assert.equal(october.days[17].type, "");
  assert.equal(months.find((month) => month.key === "2026-11").days[0].type, "rest");
  assert.equal(months.find((month) => month.key === "2026-11").days[0].code, "DS");
  assert.equal(months.find((month) => month.key === "2026-11").source, "company");
});
