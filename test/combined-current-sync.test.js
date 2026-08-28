import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("combined current sync updates the general board only through the portal worker", () => {
  const combined = fs.readFileSync("scripts/windows/run-combined-current-sync.ps1", "utf8");
  assert.match(combined, /run-operational-sync\.ps1/);
  assert.match(combined, /-SkipGeneralBoard/);
  assert.match(combined, /queue-all-portal-syncs\.ps1/);
  assert.match(combined, /-Mode CurrentMonth/);
  assert.doesNotMatch(combined, /sync-general-board\.js/);
  assert.doesNotMatch(combined, /Comprobando que Supabase acepta el worker/);
});

test("operational sync can skip its general-board call", () => {
  const operational = fs.readFileSync("scripts/windows/run-operational-sync.ps1", "utf8");
  assert.match(operational, /\[switch\]\$SkipGeneralBoard/);
  assert.match(operational, /if \(-not \$SkipGeneralBoard\)[\s\S]*sync-general-board\.js/);
});
