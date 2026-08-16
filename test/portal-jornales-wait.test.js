import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  PORTAL_CURRENT_PERIOD_ATTEMPTS,
  PORTAL_PERIOD_RETRY_DELAY_MS,
  PORTAL_PERIOD_TIMEOUT_MS
} from "../scripts/sync-portal-oficial.js";

const syncSource = fs.readFileSync(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");
const jobSource = fs.readFileSync(new URL("../scripts/sync-portal-oficial-job.js", import.meta.url), "utf8");

test("espera hasta 35 segundos a que el portal publique cada periodo de jornales", () => {
  assert.equal(PORTAL_PERIOD_TIMEOUT_MS, 35000);
  assert.match(syncSource, /periodPage\.goto\(selectorUrl, \{ waitUntil: "domcontentloaded", timeout: PORTAL_PERIOD_TIMEOUT_MS \}\)/);
  assert.doesNotMatch(syncSource, /fastMode\s*\?\s*4000\s*:\s*20000/);
});

test("reintenta hasta tres veces el mes actual aunque ya exista historial", () => {
  assert.equal(PORTAL_CURRENT_PERIOD_ATTEMPTS, 3);
  assert.equal(PORTAL_PERIOD_RETRY_DELAY_MS, 1500);
  assert.match(syncSource, /const attempts = month === currentMonth \? PORTAL_CURRENT_PERIOD_ATTEMPTS : 1/);
  assert.match(syncSource, /month === currentMonth && !historyByMonth\.has\(currentMonth\)/);
  assert.doesNotMatch(syncSource, /historyByMonth\.size === 0/);
  assert.doesNotMatch(syncSource, /if \(!fastMode && month === currentMonth/);
});

test("la primera sincronizacion fuerza el historial completo para alimentar el Sueldometro", () => {
  assert.match(jobSource, /async function hasSavedJornales\(chapa\)/);
  assert.match(jobSource, /await hasSavedJornales\(job\.chapa\)/);
  assert.match(jobSource, /CPE_PORTAL_FAST_MODE: canUseFastMode \? "true" : "false"/);
});
