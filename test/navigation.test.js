import test from "node:test";
import assert from "node:assert/strict";
import { hashForTab, tabFromHash } from "../src/navigation.js";

test("restaura varias secciones internas desde su hash", () => {
  assert.equal(tabFromHash("#/puertas"), "puertas");
  assert.equal(tabFromHash("#/portal"), "portal");
  assert.equal(tabFromHash("#/tablon"), "tablon");
});

test("normaliza rutas válidas y usa Inicio para rutas desconocidas", () => {
  assert.equal(tabFromHash("#censo"), "censo");
  assert.equal(tabFromHash("#/no-existe"), "inicio");
  assert.equal(hashForTab("no-existe"), "#/inicio");
});
