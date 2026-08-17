import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const terraform = await readFile(new URL("../deploy/oracle/main.tf", import.meta.url), "utf8");
const versions = await readFile(new URL("../deploy/oracle/versions.tf", import.meta.url), "utf8");
const cloudInit = await readFile(new URL("../deploy/oracle/cloud-init.tftpl", import.meta.url), "utf8");
const variables = await readFile(new URL("../deploy/oracle/variables.tf", import.meta.url), "utf8");
const installer = await readFile(new URL("../scripts/linux/install-vps-worker.sh", import.meta.url), "utf8");
const runner = await readFile(new URL("../scripts/linux/run-portal-worker.sh", import.meta.url), "utf8");
const setup = await readFile(new URL("../scripts/linux/open-cloudflare-setup.sh", import.meta.url), "utf8");

test("Oracle usa Ampere Always Free y solo publica SSH", () => {
  assert.match(terraform, /VM\.Standard\.A1\.Flex/);
  assert.match(terraform, /ocpus\s+=\s+2/);
  assert.match(terraform, /memory_in_gbs\s+=\s+12/);
  assert.match(terraform, /tcp_options\s+\{[\s\S]*min\s+=\s+22[\s\S]*max\s+=\s+22/);
  assert.doesNotMatch(terraform, /min\s+=\s+(?:5900|6080)/);
  assert.match(versions, /source\s+=\s+"oracle\/oci"/);
});

test("el escritorio remoto queda ligado a localhost", () => {
  assert.match(installer, /x11vnc -display :99 -localhost/);
  assert.match(installer, /websockify --web=\/usr\/share\/novnc\/ 127\.0\.0\.1:6080 localhost:5900/);
});

test("el servicio ARM usa Chromium y limita Oracle a tandas de tres", () => {
  assert.match(installer, /playwright install-deps chromium/);
  assert.match(installer, /playwright install chromium/);
  assert.match(runner, /CPE_PORTAL_WORKER_BATCH_SIZE:-3/);
  assert.match(runner, /CPE_PORTAL_BROWSER_CHANNEL:-bundled/);
  assert.match(setup, /chromium\.executablePath\(\)/);
});

test("cloud-init instala las dos ramas Oracle sin activar los workers", () => {
  assert.match(variables, /codex\/oracle-arm-workers/);
  assert.match(variables, /codex\/oracle-arm-contracting/);
  assert.match(cloudInit, /install-contracting-worker\.sh/);
  assert.doesNotMatch(cloudInit, /enable --now appcpe-portal-worker/);
  assert.doesNotMatch(cloudInit, /enable --now appcpe-contracting-worker/);
});
