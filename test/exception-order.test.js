import test from "node:test";
import assert from "node:assert/strict";
import { compareExceptionsDescending } from "../src/exceptionOrder.js";

test("ordena primero la jornada más tardía cuando hay varias excepciones el mismo día", () => {
  const rows = [
    { date: "2026-08-17", shift: "DE 08 A 14 H.", requestedAt: "2026-08-05" },
    { date: "2026-08-17", shift: "DE 14 A 20 H.", requestedAt: "2026-08-05" },
    { date: "2026-08-16", shift: "DE 20 A 02 H.", requestedAt: "2026-08-04" }
  ].sort(compareExceptionsDescending);

  assert.equal(rows[0].shift, "DE 14 A 20 H.");
  assert.equal(rows[1].shift, "DE 08 A 14 H.");
  assert.equal(rows[2].date, "2026-08-16");
});
