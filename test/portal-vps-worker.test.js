import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const terraform = await readFile(new URL("../deploy/hetzner/main.tf", import.meta.url), "utf8");
const versions = await readFile(new URL("../deploy/hetzner/versions.tf", import.meta.url), "utf8");
const cloudInit = await readFile(new URL("../deploy/hetzner/cloud-init.tftpl", import.meta.url), "utf8");
const variables = await readFile(new URL("../deploy/hetzner/variables.tf", import.meta.url), "utf8");
const installer = await readFile(new URL("../scripts/linux/install-vps-worker.sh", import.meta.url), "utf8");
const runner = await readFile(new URL("../scripts/linux/run-portal-worker.sh", import.meta.url), "utf8");

test("el VPS conserva una IPv4 primaria y solo publica SSH", () => {
  assert.match(terraform, /resource "hcloud_primary_ip" "worker"/);
  assert.match(terraform, /auto_delete\s+=\s+false/);
  assert.match(terraform, /port\s+=\s+"22"/);
  assert.doesNotMatch(terraform, /port\s+=\s+"(?:5900|6080)"/);
  assert.match(versions, /version = "~> 1\.66"/);
});

test("el escritorio remoto queda ligado a localhost", () => {
  assert.match(installer, /x11vnc -display :99 -localhost/);
  assert.match(installer, /websockify --web=\/usr\/share\/novnc\/ 127\.0\.0\.1:6080 localhost:5900/);
});

test("el servicio arranca sin login y usa tandas de diez", () => {
  assert.match(installer, /WantedBy=multi-user\.target/);
  assert.match(installer, /systemctl enable --now appcpe-display\.service/);
  assert.match(runner, /CPE_PORTAL_WORKER_BATCH_SIZE:-10/);
});

test("el mismo VPS prepara el worker compartido del tablon sin activarlo", () => {
  assert.match(variables, /portal_estiba_repository_branch/);
  assert.match(variables, /codex\/vps-contracting-worker/);
  assert.match(cloudInit, /\/opt\/portal-estiba-vlc/);
  assert.match(cloudInit, /install-contracting-worker\.sh/);
});
