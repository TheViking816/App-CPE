import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const syncSource = fs.readFileSync(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");
const monitorSource = fs.readFileSync(new URL("../src/AdminMonitor.jsx", import.meta.url), "utf8");

test("las cargas históricas descargan únicamente nóminas del año actual", () => {
  assert.match(syncSource, /timeZone: "Europe\/Madrid"/);
  assert.match(syncSource, /portalRequestKind !== "history" \|\| belongsToCurrentYear\(payroll\)/);
  assert.match(syncSource, /Nominas limitadas al ano \$\{currentMadridYear\}/);
  assert.match(monitorSource, /guarda las nóminas del año actual/);
});

test("una nómina solicitada expresamente no queda bloqueada por el filtro anual", () => {
  assert.match(syncSource, /const targetIndexes = documentId\s*\? \[targetIndex\]/);
});
