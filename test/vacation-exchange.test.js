import test from "node:test";
import assert from "node:assert/strict";
import { assignedVacationDays, canRespondToVacationOffer, dateRangeKeys, vacationSelectionPatch } from "../src/vacationExchange.js";

test("vacation offers may contain one day or a consecutive period", () => {
  assert.deepEqual(dateRangeKeys("2026-11-03", "2026-11-03"), ["2026-11-03"]);
  assert.deepEqual(dateRangeKeys("2026-11-03", "2026-11-05"),
    ["2026-11-03", "2026-11-04", "2026-11-05"]);
  assert.deepEqual(dateRangeKeys("2026-11-05", "2026-11-03"), []);
});

test("only a reciprocal assigned vacation period can answer, regardless of rest group", () => {
  const assigned = assignedVacationDays({ rows: [{ inicio: "03/11/2026", fin: "05/11/2026" }] });
  const offer = { status: "open", offeredStart: "2026-12-01", offeredEnd: "2026-12-03",
    wantedStart: "2026-11-03", wantedEnd: "2026-11-05", restGroup: "C-N" };
  assert.equal(canRespondToVacationOffer(offer, assigned), true);
  assert.equal(canRespondToVacationOffer({ ...offer, wantedEnd: "2026-11-06" }, assigned), false);
  assert.equal(canRespondToVacationOffer({ ...offer, isOwn: true }, assigned), false);
  assert.equal(canRespondToVacationOffer({ ...offer, offeredStart: "2026-11-03", offeredEnd: "2026-11-05" }, assigned), false);
});

test("tocar VA rellena Tengo y tocar otro día rellena Quiero", () => {
  assert.deepEqual(vacationSelectionPatch("2026-11-03", true),
    { offeredStart: "2026-11-03", offeredEnd: "2026-11-03" });
  assert.deepEqual(vacationSelectionPatch("2026-11-04", false),
    { wantedStart: "2026-11-04", wantedEnd: "2026-11-04" });
});
