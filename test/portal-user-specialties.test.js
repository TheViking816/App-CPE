import test from "node:test";
import assert from "node:assert/strict";
import { parsePortalIdentity, parseUserSpecialties } from "../scripts/sync-portal-oficial.js";
import { findByChapa, getSpecialty, validateSpecialtyCenso } from "../src/censo.js";

test("lee especialidades y polivalencias desde Mis especialidades", () => {
  const parsed = parseUserSpecialties(`
    <h2>Mis especialidades</h2>
    <h3>Especialidades</h3><div>CLASIFICADOR</div>
    <h3>Polivalencias</h3><div>CONDUCTOR 1A</div><div>ESPECIALISTA</div>
  `);

  assert.equal(parsed.recognized, true);
  assert.deepEqual(parsed.specialties, ["clasificador"]);
  assert.deepEqual(parsed.polyvalences, ["pol-conductor-1a", "pol-especialista"]);
  assert.deepEqual(parsed.ids, ["clasificador", "pol-conductor-1a", "pol-especialista"]);
});

test("TU se guarda como especialidad y TP como polivalencia", () => {
  const parsed = parseUserSpecialties(`
    <h2>Mis especialidades</h2>
    <div>CLASIFICADOR TU</div>
    <div>CONDUCTOR 1A TP</div>
  `);

  assert.deepEqual(parsed.specialties, ["clasificador"]);
  assert.deepEqual(parsed.polyvalences, ["pol-conductor-1a"]);
  assert.deepEqual(parsed.ids, ["clasificador", "pol-conductor-1a"]);
});

test("lee nombre y apellidos desde la cabecera del portal", () => {
  assert.deepEqual(
    parsePortalIdentity("63179 - CARBONELL BERNAT, JORGE  Finalizar sesión", "63179"),
    { chapa: "63179", name: "JORGE CARBONELL BERNAT", recognized: true }
  );
});

test("no confunde una pagina cualquiera con Mis especialidades", () => {
  assert.deepEqual(parseUserSpecialties("<div>Consulta de jornales</div>"), {
    recognized: false,
    specialties: [],
    polyvalences: [],
    ids: []
  });
});

test("Clasificador usa su propio censo y sus puertas oficiales", () => {
  const specialty = getSpecialty("clasificador");
  assert.equal(validateSpecialtyCenso("clasificador").ok, true);
  assert.equal(findByChapa("63178", "clasificador")?.position, 116);
  assert.equal(findByChapa("63179", "clasificador")?.position, 117);
  assert.deepEqual(specialty.doors.map(({ key, raw }) => [key, raw]), [
    ["LAB", 71009],
    ["NOC", 71749],
    ["NOC-FES", 63090],
    ["FES", 63114]
  ]);
});
