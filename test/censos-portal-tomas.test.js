import assert from "node:assert/strict";
import test from "node:test";

import portalCensusCapture from "../src/censosPortalCurrent.js";
import { findByChapa, getDoorState, specialties, validateSpecialtyCenso } from "../src/censo.js";

const expected = {
  mafis: ["especialidad", 82],
  "apoyo-operacion": ["especialidad", 328],
  "trastainers-rtt": ["especialidad", 662],
  container: ["especialidad", 408],
  "pol-capataz": ["polivalencia", 33],
  "pol-sobordista": ["polivalencia", 37],
  "pol-elevadoras": ["polivalencia", 139],
  "pol-trincador": ["polivalencia", 587],
  "pol-especialista": ["polivalencia", 1304],
  "pol-conductor-2a": ["polivalencia", 500]
};

test("la captura conserva separados los censos TU y TP", () => {
  assert.equal(portalCensusCapture.sourceUser, "71206");
  assert.equal(portalCensusCapture.cards.filter((item) => item.portalType === "TU").length, 4);
  assert.equal(portalCensusCapture.cards.filter((item) => item.portalType === "TP").length, 6);
  for (const [id, [kind, size]] of Object.entries(expected)) {
    const item = specialties.find((specialty) => specialty.id === id);
    assert.ok(item, `Falta ${id}`);
    assert.equal(item.kind, kind);
    assert.equal(item.censo.length, size);
    assert.equal(item.doors.length, 4);
    assert.equal(validateSpecialtyCenso(id).ok, true);
  }
});

test("Reserva G IV es contratación anticipada, no un censo seleccionable", () => {
  assert.equal(specialties.some((item) => item.id === "pol-reserva-g-iv"), false);
});

test("Tomas figura en los censos donde aparece en el Chapero", () => {
  for (const id of ["mafis", "trastainers-rtt", "pol-capataz", "pol-sobordista", "pol-elevadoras", "pol-conductor-2a"]) {
    assert.ok(findByChapa("71206", id), `Falta Tomas en ${id}`);
  }
});

test("una asignación TP sin chapa en el censo no inventa posición ni distancia", () => {
  for (const id of ["pol-trincador", "pol-especialista"]) {
    const item = specialties.find((specialty) => specialty.id === id);
    assert.equal(findByChapa("71206", id), null);
    assert.ok(getDoorState("71206", item.doors, id).every((door) => door.distance === null));
  }
});
