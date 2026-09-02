import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const puertasSource = fs.readFileSync(new URL("../scripts/sync-puertas.js", import.meta.url), "utf8");
const chaperoSource = fs.readFileSync(new URL("../scripts/sync-chapero.js", import.meta.url), "utf8");
const runnerSource = fs.readFileSync(new URL("../scripts/windows/run-operational-sync.ps1", import.meta.url), "utf8");
const calendarRunnerSource = fs.readFileSync(new URL("../scripts/windows/run-calendar-aware-combined-sync.ps1", import.meta.url), "utf8");
const calendarInstallerSource = fs.readFileSync(new URL("../scripts/windows/install-app-cpe-calendar-schedule.ps1", import.meta.url), "utf8");
const restMonthVerifierSource = fs.readFileSync(new URL("../scripts/verify-rest-month-window.js", import.meta.url), "utf8");
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

test("el worker operativo renueva Cloudflare y reintenta solo ante HTTP 403", () => {
  assert.match(runnerSource, /OperationalAttempts = 3/);
  assert.match(runnerSource, /HTTP\\s\+403/);
  assert.match(runnerSource, /start-cloudflare-gateway\.ps1/);
  assert.match(runnerSource, /Invoke-OperationalReader[\s\S]*sync-puertas\.js/);
  assert.match(runnerSource, /Invoke-OperationalReader[\s\S]*sync-chapero\.js/);
  assert.match(runnerSource, /if \(-not \$isForbidden -or \$attempt -ge \$OperationalAttempts\)/);
});

test("el horario combinado espera el resultado real y lo devuelve al Programador", () => {
  assert.match(calendarRunnerSource, /run-combined-current-sync\.ps1/);
  assert.match(calendarRunnerSource, /\$combinedExitCode = \$LASTEXITCODE/);
  assert.match(calendarRunnerSource, /if \(\$combinedExitCode -ne 0\)/);
  assert.doesNotMatch(calendarRunnerSource, /Start-Process/);
  assert.doesNotMatch(calendarRunnerSource, /Start-Sleep -Seconds 45/);
});

test("los horarios comunes ejecutan el runner sin accesos directos asincronos", () => {
  assert.match(calendarInstallerSource, /\$dailyAction = New-CalendarAction "Common"/);
  assert.match(calendarInstallerSource, /New-CalendarAction "MonthRollover"/);
  assert.match(calendarInstallerSource, /StartWhenAvailable/);
  assert.match(calendarRunnerSource, /lastRolloverMonth/);
  assert.match(calendarRunnerSource, /verify-rest-month-window\.js/);
  assert.match(calendarRunnerSource, /Cambio de mes \$monthKey marcado como completado/);
  assert.match(restMonthVerifierSource, /invalid\.length/);
  assert.doesNotMatch(calendarInstallerSource, /EncodedCommand|Start-Process|Start-Sleep/);
});
