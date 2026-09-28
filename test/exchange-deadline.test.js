import test from "node:test";
import assert from "node:assert/strict";
import { madridTodayKey, restOfferExpired, vacationOfferExpired } from "../src/exchangeDeadline.js";

test("Madrid calendar day controls the exchange deadline across UTC midnight", () => {
  assert.equal(madridTodayKey(new Date("2026-09-27T22:30:00Z")), "2026-09-28");
  assert.equal(madridTodayKey(new Date("2026-12-31T23:30:00Z")), "2027-01-01");
});

test("a rest offer closes when either relevant day begins", () => {
  const today = "2026-09-28";
  assert.equal(restOfferExpired({ offeredDate: "2026-09-29", wantedDate: today }, today), true);
  assert.equal(restOfferExpired({ offeredDate: today, wantedDate: "2026-09-29" }, today), true);
  assert.equal(restOfferExpired({ offeredDate: "2026-09-29", wantedDate: "2026-09-30" }, today), false);
  assert.equal(restOfferExpired({ offeredDate: "2026-09-27", wantedDate: "2026-09-30" }, today), true);
});

test("a vacation exchange closes when either vacation period begins", () => {
  const today = "2026-09-28";
  assert.equal(vacationOfferExpired({ offeredStart: "2026-10-02", wantedStart: today }, today), true);
  assert.equal(vacationOfferExpired({ offeredStart: today, wantedStart: "2026-10-02" }, today), true);
  assert.equal(vacationOfferExpired({ offeredStart: "2026-10-01", wantedStart: "2026-10-02" }, today), false);
});
