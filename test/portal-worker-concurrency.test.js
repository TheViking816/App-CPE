import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../scripts/portal-sync-worker.js", import.meta.url), "utf8");

test("el worker permite concurrencia acotada y conserva uno como valor normal", () => {
  assert.match(source, /CPE_PORTAL_WORKER_CONCURRENCY \|\| 1/);
  assert.match(source, /Math\.min\(32/);
  assert.match(source, /Promise\.all\(Array\.from\(\{ length: concurrency \}/);
});

test("cada worker paralelo usa un perfil de Chrome independiente", () => {
  assert.match(source, /function profileForSlot\(slot\)/);
  assert.match(source, /`worker-\$\{slot\}`/);
  assert.match(source, /CPE_PORTAL_PROFILE_DIR: profileDir/);
});
