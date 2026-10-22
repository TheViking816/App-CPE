import assert from "node:assert/strict";
import test from "node:test";

import portalCensusCapture from "../src/censosPortalCurrent.js";
import { findByChapa, specialties, validateSpecialtyCenso } from "../src/censo.js";

const expected = {
  mafis: ["especialidad", 84, [71434, 71622, 71340, 71542]],
  "apoyo-operacion": ["especialidad", 333, [71842, 72005, 71501, 72557]],
  "trastainers-rtt": ["especialidad", 668, [71459, 71954, 72092, 72214]],
  container: ["especialidad", 412, [71787, 72086, 72116, 71914]],
  "pol-capataz": ["polivalencia", 44, [71003, 71434, 71434, 71434]],
  "pol-sobordista": ["polivalencia", 48, [71003, 71434, 71434, 71434]],
  "pol-elevadoras": ["polivalencia", 129, [71358, 71767, 71481, 71490]],
  "pol-trincador": ["polivalencia", 602, [72027, 72663, 72692, 71770]],
  "pol-especialista": ["polivalencia", 1339, [63089, 72507, 71497, 72345]],
  "pol-conductor-2a": ["polivalencia", 489, [71434, 63291, 71135, 63301]]
};

test("la captura de Tomas conserva separados los censos TU y TP", () => {
  assert.equal(portalCensusCapture.sourceUser, "71206");
  assert.equal(portalCensusCapture.cards.filter((item) => item.portalType === "TU").length, 4);
  assert.equal(portalCensusCapture.cards.filter((item) => item.portalType === "TP").length, 6);

  for (const [id, [kind, size, doors]] of Object.entries(expected)) {
    const item = specialties.find((specialty) => specialty.id === id);
    assert.ok(item, `Falta ${id}`);
    assert.equal(item.kind, kind);
    assert.equal(item.censo.length, size);
    assert.deepEqual(item.doors.map((door) => door.raw), doors);
    assert.equal(validateSpecialtyCenso(id).ok, true);
  }
});

test("Reserva G IV se muestra como TP sin inventar un censo ausente", () => {
  const reserve = specialties.find((item) => item.id === "pol-reserva-g-iv");
  assert.equal(reserve.kind, "polivalencia");
  assert.deepEqual(reserve.censo, []);
  assert.deepEqual(reserve.doors, []);
});

test("Tomas aparece en los censos donde el Chapero lo incluye", () => {
  for (const id of ["mafis", "pol-capataz", "pol-sobordista", "pol-elevadoras", "conductor-2a"]) {
    assert.ok(findByChapa("71206", id), `No se encontro a Tomas en ${id}`);
  }
});
