import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBolsaChapa } from "../scripts/bolsa-worker-directory.js";
import { formatBolsaChapa } from "../src/generalBoard.js";

test("normaliza una chapa del censo de bolsa con el prefijo 80", () => {
  assert.equal(normalizeBolsaChapa("7"), "80007");
  assert.equal(normalizeBolsaChapa("584"), "80584");
  assert.equal(normalizeBolsaChapa("80584"), "80584");
  assert.equal(normalizeBolsaChapa("72683"), "");
});

test("el tablón muestra siempre completa la chapa de bolsa", () => {
  assert.equal(formatBolsaChapa("39"), "80039");
  assert.equal(formatBolsaChapa("539"), "80539");
  assert.equal(formatBolsaChapa("80539"), "80539");
});
