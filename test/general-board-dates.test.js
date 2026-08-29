import test from "node:test";
import assert from "node:assert/strict";
import { generalBoardPortalDates } from "../scripts/general-board-dates.js";

test("el sábado consulta también el lunes", () => {
  const dates = generalBoardPortalDates(new Date("2026-08-29T10:00:00Z"));

  assert.deepEqual(dates.portalDates, ["29/08/2026", "30/08/2026", "31/08/2026"]);
  assert.equal(dates.todayIso, "2026-08-29");
});

test("fuera del sábado mantiene hoy y mañana", () => {
  const dates = generalBoardPortalDates(new Date("2026-08-28T10:00:00Z"));

  assert.deepEqual(dates.portalDates, ["28/08/2026", "29/08/2026"]);
});
