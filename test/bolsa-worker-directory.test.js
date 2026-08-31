import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBolsaChapa, shouldReplaceBolsaName } from "../scripts/bolsa-worker-directory.js";
import { formatBolsaChapa } from "../src/generalBoard.js";

test("normaliza una chapa del censo de bolsa con el prefijo 80", () => {
  assert.equal(normalizeBolsaChapa("7"), "80007");
  assert.equal(normalizeBolsaChapa("584"), "80584");
  assert.equal(normalizeBolsaChapa("80584"), "80584");
  assert.equal(normalizeBolsaChapa("B80584"), "80584");
  assert.equal(normalizeBolsaChapa("C-80584"), "80584");
  assert.equal(normalizeBolsaChapa("72683"), "");
});

test("an official part name replaces a shorter manually captured name", () => {
  assert.equal(shouldReplaceBolsaName(
    { display_name: "ROCIO MUÑOZ RUIZ", source: "app_cpe" },
    { display_name: "Rocio", source: "manual" }
  ), false);
  assert.equal(shouldReplaceBolsaName(
    { display_name: "Rocio", source: "manual" },
    { display_name: "ROCIO MUÑOZ RUIZ", source: "app_cpe" }
  ), true);
});

test("a shorter official name does not degrade a fuller manual name", () => {
  assert.equal(shouldReplaceBolsaName(
    { display_name: "NOMBRE CONFIRMADO", source: "manual" },
    { display_name: "NOMBRE", source: "app_cpe" }
  ), false);
});

test("el tablón muestra siempre completa la chapa de bolsa", () => {
  assert.equal(formatBolsaChapa("39"), "80039");
  assert.equal(formatBolsaChapa("539"), "80539");
  assert.equal(formatBolsaChapa("80539"), "80539");
});
