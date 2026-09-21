import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("las primas con importe no cambian de color segun el estado del portal", () => {
  assert.doesNotMatch(app, /is-prima\$\{item\.payroll\?\.primaVerification/);
  assert.doesNotMatch(app, /is-unverified-prima/);
  assert.match(app, /portal-premium-label/);
  assert.match(app, /portal-premium-amount/);
  assert.match(styles, /\.portal-premium-label\s*\{[^}]*color:\s*#087f5b/s);
  assert.match(styles, /\.portal-premium-amount\s*\{[^}]*color:\s*var\(--ink\)\s*!important/s);
});

test("prima pendiente se conserva solo cuando no existe importe", () => {
  assert.match(app, /payroll\.prima != null \? formatEuro\(payroll\.prima\) : "Pendiente"/);
  assert.match(app, /item\.payroll\?\.prima > 0 \? formatEuro\(item\.payroll\.prima\) : "Pendiente"/);
});
