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

test("las ofertas publicadas tienen su propio tipo y filtro en novedades", () => {
  assert.match(appSource, /rest_offer_published: \{ label: "Tablón de descansos"/);
  assert.match(appSource, /vacation_offer_published: \{ label: "Tablón de vacaciones"/);
  assert.match(appSource, /filter === "board"/);
  assert.match(appSource, /\["board", "Tablón"\]/);
});

test("el acceso general abre la raíz del portal y no el fragmento User", () => {
  assert.match(appSource, /href=\{PORTAL_HOME_URL\}/);
  assert.doesNotMatch(appSource, /href="https:\/\/portal\.cpevalencia\.com\/#User"/);
  assert.doesNotMatch(appSource, /Abre el portal e inicia sesión si te la solicita\./);
  assert.doesNotMatch(appSource, /href="https:\/\/portal\.cpevalencia\.com\/Noray\/Prueba\.asp/);
  assert.doesNotMatch(appSource, /href="https:\/\/portal\.cpevalencia\.com\/Noray\/src\/VacacionesC24UniVac\/VacacionesC24\.asp"/);
});
