import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../scripts/portal-sync-worker.js", import.meta.url), "utf8");
const scheduleInstallerSource = fs.readFileSync(new URL("../scripts/windows/install-portal-sync-schedule.ps1", import.meta.url), "utf8");

test("el worker procesa tandas acotadas de cinco por defecto", () => {
  assert.match(source, /CPE_PORTAL_WORKER_BATCH_SIZE/);
  assert.match(source, /\|\| 5/);
  assert.match(source, /Math\.min\(32/);
  assert.match(source, /limit=\$\{batchSize\}/);
  assert.match(source, /\.\.\.jobs\.map\(\(job, index\) => runJob/);
  assert.match(source, /Tanda de \$\{jobs\.length\} finalizada/);
});

test("el worker espera los reintentos diferidos antes de cerrar una tanda", () => {
  assert.match(source, /nextDelayedJobWaitMs/);
  assert.match(source, /6 \* 60 \* 1000/);
  assert.match(source, /Esperando .*reintento automatico/);
});

test("cada worker paralelo usa un perfil de Chrome independiente", () => {
  assert.match(source, /function profileForSlot\(slot\)/);
  assert.match(source, /`worker-\$\{slot\}`/);
  assert.match(source, /CPE_PORTAL_PROFILE_DIR: profileDir/);
});

test("el arranque solo consume trabajos ya en cola", () => {
  assert.doesNotMatch(source, /app_cpe_create_worker_catchup_jobs/);
});

test("Windows elimina la programación horaria y deja la ejecución manual", () => {
  assert.match(scheduleInstallerSource, /Unregister-ScheduledTask/);
  assert.match(scheduleInstallerSource, /Actualizaciones horarias desactivadas/);
  assert.doesNotMatch(scheduleInstallerSource, /New-ScheduledTaskTrigger|-Daily/);
});

test("recupera trabajos en cola aunque vencieran con el equipo apagado", () => {
  assert.doesNotMatch(source, /status=eq\.queued&expires_at=gt/);
  assert.match(source, /expires_at: new Date\(Date\.now\(\) \+ 12 \* 60 \* 60 \* 1000\)/);
});
