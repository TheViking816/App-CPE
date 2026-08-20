import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Scrapfly pilot passes the remote CDP endpoint to each portal job", () => {
  const worker = fs.readFileSync("scripts/portal-sync-worker.js", "utf8");
  assert.match(worker, /portalBrowserProvider/);
  assert.match(worker, /scrapflyMode/);
  assert.match(worker, /CPE_PORTAL_CDP_ENDPOINT:\s*portalCdpEndpoint/);
});

test("Scrapfly pilot is sequential and isolates the control chapa", () => {
  const runner = fs.readFileSync("scripts/windows/run-scrapfly-portal-pilot.ps1", "utf8");
  assert.match(runner, /CPE_PORTAL_WORKER_BATCH_SIZE = "1"/);
  assert.match(runner, /CPE_PORTAL_WORKER_DRAIN = "true"/);
  assert.match(runner, /TargetChapa = "72683"/);
  assert.match(runner, /requeue-cloudflare-lab-job\.ps1/);
});
