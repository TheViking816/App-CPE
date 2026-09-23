import test from "node:test";
import assert from "node:assert/strict";
import { canRespondToRestOffer, confirmedRestExchangeDays } from "../src/restExchange.js";

test("only personal portal DS and FS may be offered; SL, VA and inferred weekends cannot", () => {
  const dates = confirmedRestExchangeDays({
    worker: { group: "A-V" },
    months: [{ year: 2026, month: 9, days: [
      { day: 23, code: "DS" }, { day: 24, code: "FS" }, { day: 25, code: "SL" },
      { day: 26, code: "" }, { day: 27, code: "VA" }, { day: 28, code: "DS" }
    ] }]
  }, { rows: [{ inicio: "28/09/2026", fin: "28/09/2026" }] }, [], new Date(2026, 8, 22));
  assert.deepEqual(dates.rest.map((day) => day.date), ["2026-09-23", "2026-09-24"]);
  assert.ok(dates.work.some((day) => day.date === "2026-09-26"));
  assert.ok(!dates.rest.some((day) => day.date === "2026-09-28"));
  assert.ok(!dates.rest.some((day) => day.date === "2026-10-03"));
});

test("responding requires a confirmed reciprocal day and a workday for any received rest", () => {
  const rest = new Set(["2026-09-24"]);
  const work = new Set(["2026-09-23"]);
  assert.equal(canRespondToRestOffer({ kind: "swap", status: "open", offeredDate: "2026-09-23", wantedDate: "2026-09-24" }, rest, work), true);
  assert.equal(canRespondToRestOffer({ kind: "swap", status: "open", offeredDate: "2026-09-24", wantedDate: "2026-09-23" }, rest, work), false);
  assert.equal(canRespondToRestOffer({ kind: "give", status: "open", offeredDate: "2026-09-24" }, rest, work), false);
  assert.equal(canRespondToRestOffer({ kind: "swap", status: "open", isOwn: true, offeredDate: "2026-09-23", wantedDate: "2026-09-24" }, rest, work), false);
});
