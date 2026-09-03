import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const navBlock = app.match(/const SIDE_NAV_GROUPS = \[([\s\S]*?)\n\];/)?.[1] || "";
const settingsBlock = app.match(/<section className="side-menu-settings">([\s\S]*?)<\/section>/)?.[1] || "";

test("las claves del portal se gestionan solo desde Ajustes", () => {
  assert.doesNotMatch(navBlock, /id: "portal"/);
  assert.match(settingsBlock, /Acceso al portal/);
  assert.doesNotMatch(app, /Datos guardados del portal oficial/);
  assert.doesNotMatch(app, />Cambiar acceso<\/button>/);
  assert.match(app, /const credentialsOnly = view === "all"/);
});
