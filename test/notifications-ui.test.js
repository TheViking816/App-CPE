import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const appSource = await fs.readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const navigationSource = await fs.readFile(new URL("../src/navigation.js", import.meta.url), "utf8");

test("el centro de novedades está disponible desde la campana y el menú", () => {
  assert.match(appSource, /aria-label=\{`Abrir novedades/);
  assert.match(appSource, /function NotificationsPanel/);
  assert.match(navigationSource, /"novedades"/);
});

test("gestionar descansos abre la ruta oficial completa del portal", () => {
  assert.match(appSource, /https:\/\/portal\.cpevalencia\.com\/#User,ViewNoray,18/);
  assert.doesNotMatch(appSource, /portal\.cpevalencia\.com\/Noray\/Prueba\.asp/);
});
