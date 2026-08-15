import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("la clave de seguridad abre un teclado alfanumerico", () => {
  const fieldStart = appSource.indexOf('aria-label="Clave de seguridad opcional"');
  assert.notEqual(fieldStart, -1);

  const fieldMarkup = appSource.slice(Math.max(0, fieldStart - 300), fieldStart + 300);
  assert.match(fieldMarkup, /inputMode="text"/);
  assert.match(fieldMarkup, /autoCapitalize="none"/);
  assert.doesNotMatch(fieldMarkup, /inputMode="numeric"/);
});

test("la navegacion movil respeta las zonas seguras y no es translucida", () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(styles, /padding-bottom: env\(safe-area-inset-bottom\)/);
  assert.match(styles, /min-height: calc\(68px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(styles, /\.bottom-nav[\s\S]*?background: #fff;/);
  assert.doesNotMatch(styles, /\.bottom-nav[\s\S]{0,500}?background: rgba\(255, 255, 255/);
});
