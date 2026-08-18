import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");

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
