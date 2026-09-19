import assert from "node:assert/strict";
import test from "node:test";
import { applyLiveCensusSnapshots, getSpecialty } from "../src/censo.js";
import { censusTargets, chooseCensusReaders, parseCensusCards } from "../scripts/census-cards.js";

const doors = "Lab 71483 Fes 71538 Noc 71450 NocFes 71340";

test("separa TU y TP aunque compartan nombre", () => {
  const result = parseCensusCards(`CONDUCTOR 2a TU 2 trabajadores ${doors} 71206 71111 Contratado: 0 CONDUCTOR 2a TP 2 trabajadores ${doors} 72222 73333 Contratado: 0`);
  assert.equal(result.invalid.length, 0);
  assert.deepEqual(result.cards.map((card) => card.id), ["conductor-2a", "pol-conductor-2a"]);
  assert.deepEqual(result.cards[0].censo, ["71206", "71111"]);
  assert.deepEqual(result.cards[1].censo, ["72222", "73333"]);
});

test("no publica un bloque vacío, duplicado o truncado", () => {
  const result = parseCensusCards(`MAFIS TU 3 trabajadores ${doors} 71206 71206`);
  assert.equal(result.cards.length, 0);
  assert.deepEqual(result.invalid.map((card) => card.id), ["mafis"]);
});

test("elige primero las cuentas que cubren más censos pendientes", () => {
  const users = [
    { chapa: "71111", enabled: true, specialties: ["mafis"] },
    { chapa: "72222", enabled: true, specialties: ["mafis", "pol-capataz"] },
    { chapa: "73333", enabled: false, specialties: ["clasificador"] }
  ];
  assert.deepEqual(chooseCensusReaders(users, ["mafis", "pol-capataz"]).map((user) => user.chapa), ["72222", "71111"]);
});

test("la app acepta solo censos completos con el tipo correcto", () => {
  const id = "mafis";
  const original = getSpecialty(id).censo;
  try {
    assert.equal(applyLiveCensusSnapshots([{ id, kind: "polivalencia", expectedSize: 2, censo: ["71206", "71111"] }]), 0);
    assert.equal(applyLiveCensusSnapshots([{ id, kind: "especialidad", expectedSize: 3, censo: ["71206", "71111"] }]), 0);
    assert.equal(applyLiveCensusSnapshots([{ id, kind: "especialidad", expectedSize: 2, censo: ["71206", "71111"] }]), 1);
    assert.deepEqual(getSpecialty(id).censo.map((row) => row.chapa), ["71206", "71111"]);
  } finally {
    const specialty = getSpecialty(id);
    specialty.censo = original;
    specialty.expectedSize = original.length;
  }
  assert.equal(censusTargets.length, 15);
});
