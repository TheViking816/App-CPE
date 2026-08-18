import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const puertasSource = fs.readFileSync(new URL("../scripts/sync-puertas.js", import.meta.url), "utf8");
const chaperoSource = fs.readFileSync(new URL("../scripts/sync-chapero.js", import.meta.url), "utf8");
const runnerSource = fs.readFileSync(new URL("../scripts/windows/run-operational-sync.ps1", import.meta.url), "utf8");
const installerSource = fs.readFileSync(new URL("../scripts/windows/install-operational-sync-schedule.ps1", import.meta.url), "utf8");
const workflowSource = fs.readFileSync(new URL("../.github/workflows/sync-puertas.yml", import.meta.url), "utf8");

test("Chapero y Puertas reutilizan la autorizacion del Chrome gateway", () => {
  for (const source of [puertasSource, chaperoSource]) {
    assert.match(source, /CPE_PORTAL_CDP_ENDPOINT/);
    assert.match(source, /chromium\.connectOverCDP/);
    assert.match(source, /cookie\.name === "cf_clearance"/);
    assert.match(source, /supabaseAdminHeaders/);
    assert.match(source, /\.then\(\(\) => process\.exit\(0\)\)/);
  }
});

test("el worker operativo actualiza ambos origenes y conserva GitHub solo manual", () => {
  assert.match(runnerSource, /sync-puertas\.js/);
  assert.match(runnerSource, /sync-chapero\.js/);
  assert.match(installerSource, /App CPE Chapero y Puertas/);
  assert.match(installerSource, /07:30/);
  assert.match(installerSource, /12:30/);
  assert.match(installerSource, /14:45/);
  assert.doesNotMatch(workflowSource, /^\s+schedule:/m);
  assert.match(workflowSource, /workflow_dispatch:/);
});
