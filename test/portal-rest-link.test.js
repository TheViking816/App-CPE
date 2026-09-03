import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("gestionar descansos abre la vista completa del portal", () => {
  assert.match(app, /https:\/\/portal\.cpevalencia\.com\/Noray\/Prueba\.asp\?f=1&mode=GWT&devType=Desktop&device=Desktop&browser=Chrome&os=Windows/);
  assert.doesNotMatch(app, /href="https:\/\/portal\.cpevalencia\.com\/Noray\/Prueba\.asp"/);
});
