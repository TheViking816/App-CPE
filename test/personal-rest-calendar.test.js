import test from "node:test";
import assert from "node:assert/strict";
import { buildPersonalRestMonths, companyRestType, parseRestGroup } from "../src/restCalendar.js";

test("A-V uses blue A days without a letter, A-V days, green weekends and common holidays", () => {
  const group = parseRestGroup("A - V");
  assert.equal(companyRestType(2026, 9, 24, group), "rest");
  assert.equal(companyRestType(2026, 9, 29, group), "rest");
  assert.equal(companyRestType(2026, 9, 23, group), "");
  assert.equal(companyRestType(2026, 10, 3, group), "week");
  assert.equal(companyRestType(2026, 10, 10, group), "");
  assert.equal(companyRestType(2026, 12, 25, group), "holiday");
  assert.equal(companyRestType(2026, 12, 2, group), "");
});

test("personal portal days win in the current month, history keeps all codes and vacations overlay both", () => {
  const months = buildPersonalRestMonths(
    { worker: { group: "A-V" }, months: [{ year: 2026, month: 9, days: [{ day: 23, code: "DS" }, { day: 24, code: "SL" }] }] },
    { months: [{ year: 2026, month: 8, days: [{ day: 3, code: "FM" }, { day: 4, code: "PA" }, { day: 5, code: "FH" }] }] },
    { rows: [{ inicio: "23/09/2026", fin: "24/09/2026" }] },
    new Date(2026, 8, 22)
  );
  const august = months.find((month) => month.key === "2026-08");
  const september = months.find((month) => month.key === "2026-09");
  assert.equal(august.days[2].type, "training");
  assert.equal(august.days[3].type, "permission");
  assert.equal(august.days[4].type, "holiday");
  assert.equal(september.days[22].type, "rest");
  assert.equal(september.days[22].vacation, true);
  assert.equal(september.days[23].type, "requested");
  assert.equal(september.days[23].vacation, true);
  assert.equal(months.find((month) => month.key === "2026-10").days[2].type, "week");
});

test("a blank portal day overrides a green company weekend and FS differs from DS", () => {
  const months = buildPersonalRestMonths(
    { worker: { group: "A-V" }, months: [{ year: 2026, month: 10, days: [
      { day: 9, code: "DS" }, { day: 17, code: "FS" }, { day: 18, code: "" }
    ] }] },
    null,
    null,
    new Date(2026, 8, 22)
  );
  const october = months.find((month) => month.key === "2026-10");
  assert.equal(october.days[8].type, "rest");
  assert.equal(october.days[16].type, "festive");
  assert.equal(october.days[17].type, "");
  assert.equal(months.find((month) => month.key === "2026-11").days[0].type, "week");
});
