import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../scripts/cloudflare-clearance-pool-check.js", import.meta.url), "utf8");

test("the clearance check does not mistake normal Cloudflare scripts for an active challenge", () => {
  const challengePattern = source.match(/const challengePattern = ([^;]+);/)?.[1] || "";
  assert.doesNotMatch(challengePattern, /challenge-platform|cf-chl-/);
  assert.match(challengePattern, /Ray ID/);
});

test("a recognized portal page wins over stale challenge text", () => {
  assert.match(source, /challenge = !portal && challengePattern\.test\(content\)/);
});
