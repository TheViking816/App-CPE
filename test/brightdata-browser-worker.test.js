import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");
const runner = fs.readFileSync(new URL("../scripts/windows/run-brightdata-job.ps1", import.meta.url), "utf8");
const jobSource = fs.readFileSync(new URL("../scripts/sync-portal-oficial-job.js", import.meta.url), "utf8");

test("Bright Data es opcional y no cambia el navegador local por defecto", () => {
  assert.match(source, /BRIGHTDATA_BROWSER_WS_ENDPOINT/);
  assert.match(source, /if \(brightDataBrowserEndpoint\)/);
  assert.match(source, /launchPersistentContext/);
});

test("el navegador remoto usa CDP y espera al resolvedor de CAPTCHA", () => {
  assert.match(source, /chromium\.connectOverCDP/);
  assert.match(source, /Captcha\.waitForSolve/);
  assert.match(source, /Bright Data no pudo resolver Cloudflare/);
});

test("el lanzador de prueba usa credenciales DPAPI y limpia el entorno", () => {
  assert.match(runner, /browser-endpoint\.dpapi/);
  assert.match(runner, /ConvertTo-SecureString/);
  assert.match(runner, /BRIGHTDATA_BROWSER_WS_ENDPOINT = \$null/);
  assert.match(runner, /ZeroFreeBSTR/);
});

test("la sesión remota explica el bloqueo KYC y oculta secretos en errores", () => {
  assert.match(source, /fillPortalPassword/);
  assert.match(source, /autorizacion KYC y permiso de Compliance/);
  assert.match(source, /sanitizePortalError/);
  assert.match(jobSource, /\[REDACTED\]/);
  assert.match(jobSource, /deferOutput/);
});
