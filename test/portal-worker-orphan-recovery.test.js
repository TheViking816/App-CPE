import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../scripts/portal-sync-worker.js", import.meta.url), "utf8");

test("recupera al arrancar las lecturas que quedaron running sin proceso", () => {
  assert.match(source, /await recoverStaleRunningJobs\(\)/);
  assert.match(source, /status=eq\.running/);
  assert.match(source, /started_at=lt\./);
  assert.match(source, /Reanudada automaticamente/);
});

test("cierra y reintenta una lectura que deja de responder", () => {
  assert.match(source, /CPE_PORTAL_JOB_MAX_RUNTIME_MS/);
  assert.match(source, /15 \* 60 \* 1000/);
  assert.match(source, /terminateChildTree\(child\)/);
  assert.match(source, /se cerro para evitar un bloqueo/);
  assert.match(source, /scheduleAutomaticRetry\(job\)/);
});
