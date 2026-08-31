import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  isPayrollWithinLastMonths,
  limitPayrollRowsToLastMonths
} from "../scripts/sync-portal-oficial.js";

const syncSource = fs.readFileSync(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");
const monitorSource = fs.readFileSync(new URL("../src/AdminMonitor.jsx", import.meta.url), "utf8");

test("las cargas históricas descargan únicamente nóminas de los últimos 12 meses", () => {
  assert.match(syncSource, /timeZone: "Europe\/Madrid"/);
  assert.match(syncSource, /portalRequestKind !== "history" \|\| isPayrollWithinLastMonths\(payroll\)/);
  assert.match(syncSource, /Nominas limitadas a los ultimos 12 meses/);
  assert.match(monitorSource, /guarda las nóminas de los últimos 12 meses/);
});

test("la ventana móvil cruza de año e incluye doce meses naturales", () => {
  const now = new Date("2026-08-31T10:00:00Z");
  assert.equal(isPayrollWithinLastMonths({ period: "09/25" }, now), true);
  assert.equal(isPayrollWithinLastMonths({ period: "08/26" }, now), true);
  assert.equal(isPayrollWithinLastMonths({ period: "08/25" }, now), false);
  assert.equal(isPayrollWithinLastMonths({ period: "09/26" }, now), false);
  assert.deepEqual(
    limitPayrollRowsToLastMonths([
      { id: "old", period: "08/25" },
      { id: "extra", period: "09/25" },
      { id: "regular", period: "09/25" },
      { id: "latest", period: "08/26" }
    ], now).map((row) => row.id),
    ["extra", "regular", "latest"]
  );
});

test("una nómina solicitada expresamente no queda bloqueada por el filtro anual", () => {
  assert.match(syncSource, /const targetIndexes = documentId\s*\? \[targetIndex\]/);
});
