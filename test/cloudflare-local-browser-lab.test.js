import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const syncSource = fs.readFileSync(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");
const jobSource = fs.readFileSync(new URL("../scripts/sync-portal-oficial-job.js", import.meta.url), "utf8");
const gatewaySource = fs.readFileSync(new URL("../scripts/windows/start-cloudflare-gateway.ps1", import.meta.url), "utf8");
const poolSource = fs.readFileSync(new URL("../scripts/cloudflare-clearance-pool-check.js", import.meta.url), "utf8");
const diagnosticSource = fs.readFileSync(new URL("../scripts/cloudflare-tls-diagnostic.py", import.meta.url), "utf8");
const requeueSource = fs.readFileSync(new URL("../scripts/requeue-cloudflare-lab-job.js", import.meta.url), "utf8");
const workerSource = fs.readFileSync(new URL("../scripts/portal-sync-worker.js", import.meta.url), "utf8");
const batchRunnerSource = fs.readFileSync(new URL("../scripts/windows/run-cloudflare-gateway-batch.ps1", import.meta.url), "utf8");
const persistentRunnerSource = fs.readFileSync(new URL("../scripts/windows/run-portal-worker.ps1", import.meta.url), "utf8");
const workerInstallerSource = fs.readFileSync(new URL("../scripts/windows/install-portal-worker.ps1", import.meta.url), "utf8");
const pendingShortcutSource = fs.readFileSync(new URL("../scripts/windows/install-pending-sync-shortcut.ps1", import.meta.url), "utf8");
const pendingRunnerSource = fs.readFileSync(new URL("../scripts/windows/run-pending-sync.ps1", import.meta.url), "utf8");
const operationalRunnerSource = fs.readFileSync(new URL("../scripts/windows/run-operational-sync.ps1", import.meta.url), "utf8");
const generalBoardWorkerSource = fs.readFileSync(new URL("../scripts/sync-general-board.js", import.meta.url), "utf8");
const generalBoardClientSource = fs.readFileSync(new URL("../src/generalBoard.js", import.meta.url), "utf8");

test("el lector puede adjuntarse a Chrome sin alterar el modo local existente", () => {
  assert.match(syncSource, /CPE_PORTAL_CDP_ENDPOINT/);
  assert.match(syncSource, /chromium\.connectOverCDP/);
  assert.match(syncSource, /chromium\.launchPersistentContext/);
  assert.match(syncSource, /close: async \(\) => \{\}/);
  assert.match(syncSource, /\.then\(\(\) => process\.exit\(0\)\)/);
});

test("el gateway abre Chrome visible sin indicadores inseguros", () => {
  assert.match(gatewaySource, /--remote-debugging-port=\$Port/);
  assert.match(gatewaySource, /--user-data-dir=\$ProfilePath/);
  assert.match(gatewaySource, /json\/new\?\$encodedPortalUrl/);
  assert.match(gatewaySource, /ValidateRange\(5, 180\)\]\[int\]\$WaitSeconds = 90/);
  assert.doesNotMatch(gatewaySource, /--no-sandbox/);
  assert.doesNotMatch(gatewaySource, /AutomationControlled/);
});

test("el worker no confunde los scripts normales de Cloudflare con un desafio", () => {
  const challengePatternLine = workerSource.match(/const challengePattern = ([^;]+);/)?.[1] || "";
  assert.doesNotMatch(challengePatternLine, /challenge-platform|cf-chl-/);
  assert.match(challengePatternLine, /Ray ID/);
});

test("la prueba de autorización crea como máximo diez contextos aislados", () => {
  assert.match(poolSource, /Math\.min\(10/);
  assert.match(poolSource, /browser\.newContext/);
  assert.match(poolSource, /cookie\.name === "cf_clearance"/);
  assert.doesNotMatch(poolSource, /console\.log\([^\n]*cookie\.value/);
});

test("el diagnóstico TLS no usa credenciales ni imprime el cuerpo", () => {
  assert.match(diagnosticSource, /impersonate="chrome"/);
  assert.doesNotMatch(diagnosticSource, /password|portal_password/i);
  assert.doesNotMatch(diagnosticSource, /print\(response\.text/);
});

test("los errores del trabajo ocultan las claves del portal", () => {
  assert.match(syncSource, /sanitizePortalError/);
  assert.match(jobSource, /\[REDACTED\]/);
  assert.match(jobSource, /deferOutput/);
});

test("la regeneración de 72683 restaura y valida las demás filas", () => {
  assert.match(requeueSource, /status=eq\.running/);
  assert.match(requeueSource, /worker pausado para prueba aislada/);
  assert.match(requeueSource, /app_cpe_create_worker_manual_jobs/);
  assert.match(requeueSource, /if \(row\.chapa === targetChapa\) continue/);
  assert.match(requeueSource, /JSON\.stringify\(currentState\[field\]\)/);
  assert.doesNotMatch(requeueSource, /console\.log\([^\n]*portal_password/);
});

test("la tanda real usa perfiles aislados y termina tras un solo lote", () => {
  assert.match(workerSource, /CPE_PORTAL_PROFILE_DIR: profileDir/);
  assert.match(workerSource, /CPE_PORTAL_CLEARANCE_COOKIES: JSON\.stringify/);
  assert.match(workerSource, /CPE_PORTAL_CDP_ENDPOINT: ""/);
  assert.match(syncSource, /context\.addCookies\(portalClearanceCookies\)/);
  assert.match(workerSource, /CPE_PORTAL_WORKER_ONCE/);
  assert.match(workerSource, /failQueuedJobsWithoutCredentials/);
  assert.match(workerSource, /portal_password=not\.is\.null/);
  assert.match(workerSource, /\.\.\.jobs\.map\(\(job, index\) => runJob/);
  assert.match(batchRunnerSource, /ValidateRange\(1, 32\)/);
  assert.match(batchRunnerSource, /CPE_PORTAL_WORKER_ONCE = "true"/);
});

test("el worker permanente arranca y utiliza el Chrome gateway", () => {
  assert.match(persistentRunnerSource, /start-cloudflare-gateway\.ps1/);
  assert.match(persistentRunnerSource, /CPE_PORTAL_CDP_ENDPOINT = "http:\/\/127\.0\.0\.1:\$GatewayPort"/);
  assert.match(persistentRunnerSource, /ValidateRange\(1024, 65535\)/);
  assert.match(workerSource, /gatewayAuthorizationIsValid/);
  assert.match(workerSource, /\(response\?\.status\(\) \|\| 0\) === 403/);
  assert.match(workerSource, /Math\.max\(pollMs, 30000\)/);
  assert.match(poolSource, /if \(!ok\) process\.exitCode = 3/);
  assert.match(workerSource, /startGatewayBrowser/);
  assert.match(workerSource, /El Chrome gateway se cerro; se abrira de nuevo automaticamente/);
  assert.match(workerSource, /start-cloudflare-gateway\.ps1/);
  assert.doesNotMatch(gatewaySource, /Start-PortalWorkerIfAvailable|Start-ScheduledTask/);
  assert.match(workerInstallerSource, /Disable-ScheduledTask -TaskName \$taskName/);
  assert.doesNotMatch(workerInstallerSource, /Start-ScheduledTask -TaskName \$taskName/);
});

test("el acceso de pendientes usa el mismo Chrome instalado que el gateway", () => {
  assert.match(batchRunnerSource, /CPE_PORTAL_BROWSER_CHANNEL = "chrome"/);
  assert.match(persistentRunnerSource, /CPE_PORTAL_BROWSER_CHANNEL = "chrome"/);
});

test("el worker reclama la cola antes de validar y el acceso prepara Chrome para procesar solo pendientes", () => {
  const claimPosition = workerSource.indexOf("const jobs = await claimNextBatch()");
  const authorizationPosition = workerSource.indexOf("if (!await gatewayAuthorizationIsValid())", claimPosition);
  assert.ok(claimPosition >= 0);
  assert.ok(authorizationPosition > claimPosition);
  assert.match(pendingShortcutSource, /Actualizar pendientes App CPE\.lnk/);
  assert.match(pendingShortcutSource, /run-pending-sync\.ps1/);
  assert.match(pendingRunnerSource, /start-cloudflare-gateway\.ps1/);
  assert.match(pendingRunnerSource, /Start-Sleep -Seconds \$WarmupSeconds/);
  assert.match(pendingRunnerSource, /run-cloudflare-gateway-batch\.ps1/);
  assert.match(pendingRunnerSource, /-Drain/);
  assert.doesNotMatch(pendingShortcutSource, /queue-all-portal-syncs/);
  assert.doesNotMatch(pendingRunnerSource, /queue-all-portal-syncs/);
  assert.match(workerInstallerSource, /install-pending-sync-shortcut\.ps1/);
});

test("la actualizacion global publica tambien el tablon general", () => {
  assert.match(workerSource, /trigger_source === "worker_manual_all"/);
  assert.match(workerSource, /scripts\/sync-general-board\.js/);
  assert.match(workerSource, /runGeneralBoard\(boardJob, clearanceCookies\)/);
  assert.match(generalBoardWorkerSource, /app_cpe_general_board_snapshot/);
  assert.match(generalBoardWorkerSource, /Contratacion Jornada/);
  assert.match(generalBoardClientSource, /supabase\.from\("app_cpe_general_board_snapshot"\)/);
});

test("la actualizacion operativa publica Chapero, Puertas y Tablon", () => {
  assert.match(operationalRunnerSource, /scripts\/sync-puertas\.js/);
  assert.match(operationalRunnerSource, /scripts\/sync-chapero\.js/);
  assert.match(operationalRunnerSource, /scripts\/sync-general-board\.js/);
  assert.match(generalBoardWorkerSource, /app_cpe_get_general_board_worker_credential/);
  assert.match(generalBoardWorkerSource, /CPE_GENERAL_BOARD_CDP_ENDPOINT/);
  assert.match(generalBoardWorkerSource, /\.then\(\(\) => process\.exit\(0\)\)/);
});
