import test from "node:test";
import assert from "node:assert/strict";
import { parsePortalIdentity, parseUserSpecialties } from "../scripts/sync-portal-oficial.js";
import { findByChapa, getSpecialty, validateSpecialtyCenso } from "../src/censo.js";

test("lee especialidades y polivalencias desde Mis especialidades", () => {
  const parsed = parseUserSpecialties(`
    <h2>Mis especialidades</h2>
    <h3>Especialidades</h3><div>CLASIFICADOR TU</div>
    <h3>Polivalencias</h3><div>CONDUCTOR 1A TP</div><div>ESPECIALISTA TP</div>
  `);

  assert.equal(parsed.recognized, true);
  assert.deepEqual(parsed.specialties, ["clasificador"]);
  assert.deepEqual(parsed.polyvalences, ["pol-conductor-1a", "pol-especialista"]);
  assert.deepEqual(parsed.ids, ["clasificador", "pol-conductor-1a", "pol-especialista"]);
});

test("el menú general no se confunde con la pantalla real de especialidades", () => {
  assert.equal(parseUserSpecialties(`
    <nav>Consultas · Mis especialidades</nav>
    <main>TRASTAINERS RTT · TU POSICIÓN</main>
  `).recognized, false);
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

test("lee las especialidades reales de Tomas por fila, separando TU y TP", () => {
  const rows = [
    [15, "MAFIS", "TU", "mafis"],
    [29, "APOYO OPERACION", "TU", "apoyo-operacion"],
    [22, "TRASTAINERS RTT", "TU", "trastainers-rtt"],
    [19, "CONTAINER", "TU", "container"],
    [41, "RESERVA G IV", "TP", null],
    [1, "CAPATAZ", "TP", "pol-capataz"],
    [23, "SOBORDISTA", "TP", "pol-sobordista"],
    [20, "ELEVADORAS", "TP", "pol-elevadoras"],
    [10, "TRINCADOR", "TP", "pol-trincador"],
    [3, "ESPECIALISTA", "TP", "pol-especialista"],
    [12, "CONDUCTOR 2a", "TP", "pol-conductor-2a"]
  ];
  const html = `<h2>Mis especialidades</h2><table><tr><th>Codigo</th><th>Nombre</th><th>Tipo</th></tr>${rows
    .map(([code, name, type]) => `<tr><td>${code}</td><td>${name}</td><td>${type}</td></tr>`)
    .join("")}</table>`;
  const parsed = parseUserSpecialties(html);
  assert.deepEqual(parsed.ids, rows.map((row) => row[3]).filter(Boolean));
  assert.deepEqual(parsed.specialties, rows.slice(0, 4).map((row) => row[3]));
  assert.deepEqual(parsed.polyvalences, rows.slice(4).map((row) => row[3]).filter(Boolean));
});

test("lee nombre y apellidos desde la cabecera del portal", () => {
  assert.deepEqual(
    parsePortalIdentity("63179 - CARBONELL BERNAT, JORGE  Finalizar sesión", "63179"),
    { chapa: "63179", name: "JORGE CARBONELL BERNAT", givenName: "JORGE", recognized: true }
  );
});

test("conserva los nombres de pila compuestos de la cabecera del portal", () => {
  assert.deepEqual(
    parsePortalIdentity("72614 - ESCRICH ARIÑO, MARIA PILAR  Finalizar sesión", "72614"),
    { chapa: "72614", name: "MARIA PILAR ESCRICH ARIÑO", givenName: "MARIA PILAR", recognized: true }
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
