import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

test("el equipo del parte muestra nombres completos en iPhone y otros moviles", () => {
  const mobileWorkerStyles = styles.match(/@media \(max-width: 620px\) \{[\s\S]*?\.assignment-detail-workers p span \{[\s\S]*?\n  \}\n\}/)?.[0] || "";

  assert.match(mobileWorkerStyles, /grid-template-columns: 1fr/);
  assert.match(mobileWorkerStyles, /white-space: normal/);
  assert.match(mobileWorkerStyles, /text-overflow: clip/);
  assert.match(mobileWorkerStyles, /overflow-wrap: anywhere/);
});

test("todos los grupos formados solo por chapas usan la misma cuadricula compacta", () => {
  assert.match(app, /workers\.length > 0 && workers\.every/);
  assert.doesNotMatch(app, /<em>Tu chapa<\/em>/i);
  assert.match(styles, /\.assignment-detail-workers p\.is-current-worker \{[\s\S]*?background: #0f766e;[\s\S]*?color: #fff;/);
  assert.match(styles, /\.assignment-detail-workers \.is-code-grid p\.is-current-worker \{[\s\S]*?justify-content: center;[\s\S]*?background: #0f766e;[\s\S]*?color: #fff;/);
});
