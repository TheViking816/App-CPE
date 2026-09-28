import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CLOUDFLARE_RESTART_EXIT_CODE,
  isVisiblePortalChallenge,
  PortalCloudflareRestartError
} from "../scripts/portal-cloudflare-restart.js";

const read = (file) => readFile(new URL(file, import.meta.url), "utf8");

test("detecta la pantalla visible sin confundir scripts normales de Cloudflare", () => {
  assert.equal(isVisiblePortalChallenge("Verificación de seguridad en curso\nVerifique que es un ser humano"), true);
  assert.equal(isVisiblePortalChallenge("Un momento..."), true);
  assert.equal(isVisiblePortalChallenge("<script src='/cdn-cgi/challenge-platform'></script> Finalizar sesión"), false);
  assert.equal(new PortalCloudflareRestartError().code, "CLOUDFLARE_RESTART");
  assert.equal(CLOUDFLARE_RESTART_EXIT_CODE, 75);
});

test("el bloqueo de un lector deja terminar a los demas y solo reencola los pendientes", async () => {
  const worker = await read("../scripts/portal-sync-worker.js");
  const job = await read("../scripts/sync-portal-oficial-job.js");
  const batch = await read("../scripts/windows/run-cloudflare-gateway-batch.ps1");
  assert.match(worker, /if \(code === CLOUDFLARE_RESTART_EXIT_CODE\) \{\s*requestCloudflareRestart\(job, slot\);\s*resolve\(\);\s*return;/);
  const restartHandler = worker.split("function requestCloudflareRestart(")[1]?.split("function resolveSupabaseUrl(")[0] || "";
  assert.doesNotMatch(restartHandler, /terminateChildTree|stopping = true/);
  assert.match(worker, /if \(cloudflareRestartRequested\) \{\s*await requeueRunningJobs\(jobs,/);
  assert.match(job, /if \(error\?\.code === "CLOUDFLARE_RESTART"\)/);
  assert.match(batch, /if \(\$workerExitCode -ne 75\) \{ exit \$workerExitCode \}/);
  assert.match(batch, /& node "scripts\/portal-sync-worker\.js"/);
});
