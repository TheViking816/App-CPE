import test from "node:test";
import assert from "node:assert/strict";
import { hashForTab, tabFromHash } from "../src/navigation.js";

test("restaura varias secciones internas desde su hash", () => {
  assert.equal(tabFromHash("#/puertas"), "puertas");
  assert.equal(tabFromHash("#/portal"), "portal");
  assert.equal(tabFromHash("#/tablon"), "tablon");
  assert.equal(tabFromHash("#/contratacion"), "contratacion");
  assert.equal(tabFromHash("#/sueldometro"), "sueldometro");
  assert.equal(tabFromHash("#/descansos"), "descansos");
  assert.equal(tabFromHash("#/vacaciones"), "vacaciones");
  assert.equal(tabFromHash("#/nominas"), "nominas");
  assert.equal(tabFromHash("#/estado"), "estado");
});

test("normaliza rutas válidas y usa Inicio para rutas desconocidas", () => {
  assert.equal(tabFromHash("#censo"), "censo");
  assert.equal(tabFromHash("#/no-existe"), "inicio");
  assert.equal(hashForTab("no-existe"), "#/inicio");
});
