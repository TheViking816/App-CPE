import test from "node:test";
import assert from "node:assert/strict";
import {
  assignmentDetailScore,
  parseAssignmentDetailFromText
} from "../scripts/portal-assignments.js";

test("lee el equipo responsive del parte con chapas y nombres publicados", () => {
  const detail = parseAssignmentDetailFromText(`
    PARTE
    24943
    FECHA
    01/09
    JORNADA
    02-08
    BUQUE
    MSC LAGOS X
    MUELLE
    PRINCIPE FELIPE
    EQUIPO DEL PARTE
    23 trabajadores
    Capataz
    1
    24159 RAFAEL SOLIS OLMOS
    Especialista
    6
    80774 Miguel
    80424
    80328
    80198 Hugo Calderon San Benito
    80767 Juan Carlos
    80214
    Conductor 1a
    2
    72683 ADRIAN LUJAN MARIN
    72111 CRISTIAN VICENTE CARVAJAL CARDONA
  `);

  assert.equal(detail.recognized, true);
  assert.equal(detail.parte, "24943");
  assert.deepEqual(detail.specialties.map(({ name, requested }) => ({ name, requested })), [
    { name: "Capataz", requested: 1 },
    { name: "Especialista", requested: 6 },
    { name: "Conductor 1a", requested: 2 }
  ]);
  assert.deepEqual(detail.specialties[1].workers, [
    { code: "80774", name: "Miguel" },
    { code: "80424", name: "" },
    { code: "80328", name: "" },
    { code: "80198", name: "Hugo Calderon San Benito" },
    { code: "80767", name: "Juan Carlos" },
    { code: "80214", name: "" }
  ]);
});

test("espera una version con mas nombres aunque tenga las mismas chapas", () => {
  const early = parseAssignmentDetailFromText(`EQUIPO DEL PARTE\nEspecialista\n2\n80774\n80424`);
  const settled = parseAssignmentDetailFromText(`EQUIPO DEL PARTE\nEspecialista\n2\n80774 MIGUEL MARTINEZ\n80424 ANA PEREZ`);
  assert.ok(assignmentDetailScore(settled) > assignmentDetailScore(early));
});

test("lee el modal nuevo del parte y separa su especialidad principal y los refuerzos", () => {
  const detail = parseAssignmentDetailFromText(`
    PARTE 26177 --
    FECHA 12/09/2026
    JORNADA DE 02 A 08 H.
    ESPECIALIDAD TRASTAINERS RTT
    TIPO TUR
    EMPRESA CSP IBERIAN VALENCIA TERMINAL
    MUELLE PRINCIPE FELIPE
    OPERACIÓN TRASTAINERS
    Parte 26177
    72558 TUR JUAN PINÉS FERNANDEZ
    72561 TUR JAVIER BERMUDEZ BALLESTER
    72562 TUR NOELIA GONZALEZ BENEDITO
    CONTAINER (3)
    71202 TUR AGUSTIN FERNANDEZ COS
    71209 TUR DAVID DOMINGUEZ PEREZ
    71276 TUR FCO JAVIER GARCIA BERMEJO LOPEZ
  `);

  assert.equal(detail.recognized, true);
  assert.equal(detail.parte, "26177");
  assert.equal(detail.empresa, "CSP IBERIAN VALENCIA TERMINAL");
  assert.deepEqual(detail.specialties, [
    {
      name: "TRASTAINERS RTT",
      requested: 3,
      workers: [
        { code: "72558", name: "JUAN PINÉS FERNANDEZ" },
        { code: "72561", name: "JAVIER BERMUDEZ BALLESTER" },
        { code: "72562", name: "NOELIA GONZALEZ BENEDITO" }
      ],
      bolsa: 0,
      unnamed: 0
    },
    {
      name: "CONTAINER",
      requested: 3,
      workers: [
        { code: "71202", name: "AGUSTIN FERNANDEZ COS" },
        { code: "71209", name: "DAVID DOMINGUEZ PEREZ" },
        { code: "71276", name: "FCO JAVIER GARCIA BERMEJO LOPEZ" }
      ],
      bolsa: 0,
      unnamed: 0
    }
  ]);
});

test("el modal nuevo toma los datos de la tarjeta del parte abierto y no de otra jornada", () => {
  const detail = parseAssignmentDetailFromText(`
    PARTE 26159 --
    FECHA 12/09/2026
    ESPECIALIDAD ESPECIALISTA
    EMPRESA CSP IBERIAN VALENCIA TERMINAL
    PARTE 26177 --
    FECHA 12/09/2026
    ESPECIALIDAD TRASTAINERS RTT
    EMPRESA OTRA EMPRESA
    Parte 26159
    80603 BOLSA RAFAEL ALEIXANDRE MARTI
    72558 TUR JUAN PINÉS FERNANDEZ
  `);

  assert.equal(detail.parte, "26159");
  assert.equal(detail.empresa, "CSP IBERIAN VALENCIA TERMINAL");
  assert.equal(detail.specialties[0].name, "ESPECIALISTA");
  assert.equal(detail.specialties[0].requested, 2);
  assert.deepEqual(detail.specialties[0].workers.map((worker) => worker.code), ["80603", "72558"]);
});
