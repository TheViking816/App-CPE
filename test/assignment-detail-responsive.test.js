import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("el equipo del parte muestra nombres completos en iPhone y otros moviles", () => {
  const mobileWorkerStyles = styles.match(/@media \(max-width: 620px\) \{[\s\S]*?\.assignment-detail-workers p span \{[\s\S]*?\n  \}\n\}/)?.[0] || "";

  assert.match(mobileWorkerStyles, /grid-template-columns: 1fr/);
  assert.match(mobileWorkerStyles, /white-space: normal/);
  assert.match(mobileWorkerStyles, /text-overflow: clip/);
  assert.match(mobileWorkerStyles, /overflow-wrap: anywhere/);
});
