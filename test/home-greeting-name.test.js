import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const syncSource = await readFile(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");

test("el saludo usa todos los nombres de pila separados por la coma del portal", () => {
  assert.match(appSource, /worker\?\.givenName/);
  assert.match(appSource, /matchesFirstOfficialGivenName/);
  assert.match(appSource, /return greetingName\(officialGivenName\)/);
  assert.match(syncSource, /givenName: portalIdentity\.givenName/);
});
