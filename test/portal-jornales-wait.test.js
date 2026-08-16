import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { PORTAL_PERIOD_TIMEOUT_MS } from "../scripts/sync-portal-oficial.js";

const syncSource = fs.readFileSync(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");
const jobSource = fs.readFileSync(new URL("../scripts/sync-portal-oficial-job.js", import.meta.url), "utf8");

test("espera hasta 20 segundos a que el portal publique los jornales", () => {
  assert.equal(PORTAL_PERIOD_TIMEOUT_MS, 20000);
  assert.doesNotMatch(syncSource, /fastMode\s*\?\s*4000\s*:\s*20000/);
});

test("reintenta el mes actual aunque la sincronizacion sea rapida", () => {
  assert.match(syncSource, /if \(month === currentMonth && historyByMonth\.size === 0\)/);
  assert.doesNotMatch(syncSource, /if \(!fastMode && month === currentMonth/);
});

test("la primera sincronizacion fuerza el historial completo para alimentar el Sueldometro", () => {
  assert.match(jobSource, /async function hasSavedJornales\(chapa\)/);
  assert.match(jobSource, /await hasSavedJornales\(job\.chapa\)/);
  assert.match(jobSource, /CPE_PORTAL_FAST_MODE: canUseFastMode \? "true" : "false"/);
});
