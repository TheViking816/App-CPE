import assert from "node:assert/strict";
import test from "node:test";

import portalCensusCapture from "../src/censosPortalCurrent.js";
import { findByChapa, specialties, validateCenso } from "../src/censo.js";

const expected = {
  mafis: ["especialidad", 82, [71483, 71450, 71340, 71538]],
  "apoyo-operacion": ["especialidad", 328, [71119, 72031, 72223, 72528]],
  "trastainers-rtt": ["especialidad", 662, [72278, 72593, 72155, 71191]],
  container: ["especialidad", 408, [72025, 72238, 71753, 71237]],
  "pol-capataz": ["polivalencia", 33, [71003, 71434, 71434, 71434]],
  "pol-sobordista": ["polivalencia", 37, [71003, 71434, 71434, 71434]],
  "pol-elevadoras": ["polivalencia", 139, [71358, 71767, 71481, 71490]],
  "pol-trincador": ["polivalencia", 587, [71954, 72043, 71352, 24140]],
  "pol-especialista": ["polivalencia", 1304, [24075, 72305, 24198, 63316]],
  "pol-conductor-2a": ["polivalencia", 500, [24220, 63291, 71135, 71508]]
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
    assert.equal(validateCenso(id).ok, true);
  }
});

test("Reserva G IV se muestra como TP sin inventar un censo ausente", () => {
  const reserve = specialties.find((item) => item.id === "pol-reserva-g-iv");
  assert.equal(reserve.kind, "polivalencia");
  assert.deepEqual(reserve.censo, []);
  assert.deepEqual(reserve.doors, []);
});

test("Tomas aparece en los censos donde el Chapero lo incluye", () => {
  for (const id of ["mafis", "trastainers-rtt", "pol-capataz", "pol-sobordista", "pol-elevadoras", "pol-conductor-2a"]) {
    assert.ok(findByChapa("71206", id), `No se encontro a Tomas en ${id}`);
  }
});
