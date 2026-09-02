import test from "node:test";
import assert from "node:assert/strict";
import {
  assignmentDetailScore,
  isAssignmentDetailComplete,
  parseAssignmentDetailFromTables,
  parseAssignmentsFromText
} from "../scripts/portal-assignments.js";

const detailTable = (workers) => [[
  ["Parte:", "12345"],
  ["CONDUCTOR 1a", "5", workers]
]];

test("lee la contratacion responsive aunque el portal no publique una tabla HTML", () => {
  const result = parseAssignmentsFromText(`
    jornadas contratadas
    parte
    24943
    fecha
    01/09/2026
    jornada
    DE 02 A 08 H.
    especialidad
    CONDUCTOR 1A
    empresa
    CSP IBERIAN VALENCIA TERMINAL S.A.U.
    operación
    CONT. C/SPREADER AUT
    buque
    MSC LAGOS X
    muelle
    PRINCIPE FELIPE
  `);

  assert.equal(result.recognized, true);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    parte: "24943",
    fecha: "01/09/2026",
    jornada: "DE 02 A 08 H.",
    especialidad: "CONDUCTOR 1A",
    empresa: "CSP IBERIAN VALENCIA TERMINAL S.A.U.",
    operacion: "CONT. C/SPREADER AUT",
    buque: "MSC LAGOS X",
    muelle: "PRINCIPE FELIPE"
  });
});

test("no acepta como completo un parte cuyos nombres siguen cargando", () => {
  const early = parseAssignmentDetailFromTables(detailTable("12345 - ANA 23456 - LUIS"));
  assert.equal(early.specialties[0].unnamed, 3);
  assert.equal(isAssignmentDetailComplete(early), false);
});

test("prefiere y acepta el parte cuando llegan todos los nombres", () => {
  const early = parseAssignmentDetailFromTables(detailTable("12345 - ANA 23456 - LUIS"));
  const complete = parseAssignmentDetailFromTables(detailTable(
    "12345 - ANA 23456 - LUIS 34567 - EVA 45678 - IVAN 56789 - NOA"
  ));
  assert.ok(assignmentDetailScore(complete) > assignmentDetailScore(early));
  assert.equal(complete.specialties[0].unnamed, 0);
  assert.equal(isAssignmentDetailComplete(complete), true);
});

test("prefiere chapas publicadas frente al mismo numero de ceros de bolsa", () => {
  const unresolved = parseAssignmentDetailFromTables(detailTable(
    "71001 - ANA 71002 - LUIS 00000 00000 00000"
  ));
  const mobile = parseAssignmentDetailFromTables(detailTable(
    "71001 ANA 71002 LUIS 80539 ANDREA PEREZ 80682 PABLO CHACON 80200 MIREYA SEVILLA"
  ));

  assert.equal(isAssignmentDetailComplete(unresolved), true);
  assert.equal(isAssignmentDetailComplete(mobile), true);
  assert.ok(assignmentDetailScore(mobile) > assignmentDetailScore(unresolved));
});

test("agrega cinco nombres publicados en una fila de continuacion", () => {
  const firstFifteen = Array.from({ length: 15 }, (_, index) => (
    `${String(71000 + index)} - PERSONA ${index + 1}`
  )).join(" ");
  const lastFive = Array.from({ length: 5 }, (_, index) => (
    `${String(72000 + index)} - PERSONA ${index + 16}`
  )).join(" ");
  const parsed = parseAssignmentDetailFromTables([[
    ["Parte:", "12345"],
    ["CONDUCTOR 1a", "20", firstFifteen],
    [lastFive]
  ]]);

  assert.equal(parsed.specialties[0].workers.length, 20);
  assert.equal(parsed.specialties[0].unnamed, 0);
  assert.equal(isAssignmentDetailComplete(parsed), true);
});

test("lee las chapas de bolsa sin guion que publica la version movil de Donde voy", () => {
  const parsed = parseAssignmentDetailFromTables(detailTable(
    "80539 ANDREA PEREZ CARRASCOSA 80682 PABLO CHACON RUIZ 80200 MIREYA SEVILLA JAFFIER "
    + "80248 LUIS MARTIN MONSOLIU 80735 CARLOTA CIVERA CABRERA"
  ));

  assert.deepEqual(parsed.specialties[0].workers, [
    { code: "80539", name: "ANDREA PEREZ CARRASCOSA" },
    { code: "80682", name: "PABLO CHACON RUIZ" },
    { code: "80200", name: "MIREYA SEVILLA JAFFIER" },
    { code: "80248", name: "LUIS MARTIN MONSOLIU" },
    { code: "80735", name: "CARLOTA CIVERA CABRERA" }
  ]);
  assert.equal(isAssignmentDetailComplete(parsed), true);
});

test("separa todas las chapas cuando la anticipada publica una lista sin nombres", () => {
  const parsed = parseAssignmentDetailFromTables(detailTable(
    "T71078 T71990 T71147 T71265 T71325 T72068"
  ));

  assert.deepEqual(parsed.specialties[0].workers, [
    { code: "T71078", name: "" },
    { code: "T71990", name: "" },
    { code: "T71147", name: "" },
    { code: "T71265", name: "" },
    { code: "T71325", name: "" },
    { code: "T72068", name: "" }
  ]);
});

test("puntua por debajo una lectura temprana aunque sus primeros grupos ya esten completos", () => {
  const early = parseAssignmentDetailFromTables([[
    ["Parte:", "23259"],
    ["CAPATAZ", "1", "T24068 - MIGUEL ANGEL FORTEA APARICIO"],
    ["SOBORDISTA", "2", "T24135 - ANTONIO MORENO PECO T24136 - ANTONIO CUENCA ONCINA"]
  ]]);
  const settled = parseAssignmentDetailFromTables([[
    ["Parte:", "23259"],
    ["CAPATAZ", "1", "T24068 - MIGUEL ANGEL FORTEA APARICIO"],
    ["SOBORDISTA", "2", "T24135 - ANTONIO MORENO PECO T24136 - ANTONIO CUENCA ONCINA"],
    ["CLASIFICADOR", "2", "T63089 - JOSE AURELIO LUCIA NAVARRO T63090 - AGUSTIN MORES ANDRES"],
    ["GRUAS", "2", "T71903 - VICENTE FCO. SOLIS OLMOS T71108 - ENCARNACION MUÑOZ COSTA"],
    ["TRASTAINERS RTT", "2", "T70001 - PERSONA UNO T70002 - PERSONA DOS"],
    ["ESPECIALISTA", "4", "T70003 - PERSONA TRES T70004 - PERSONA CUATRO T70005 - PERSONA CINCO T70006 - PERSONA SEIS"],
    ["CONDUCTOR 1a", "10", Array.from({ length: 10 }, (_, index) => `${71000 + index} - CONDUCTOR ${index + 1}`).join(" ")]
  ]]);

  assert.equal(isAssignmentDetailComplete(early), true);
  assert.equal(settled.specialties.length, 7);
  assert.equal(settled.specialties.reduce((total, specialty) => total + specialty.requested, 0), 23);
  assert.ok(assignmentDetailScore(settled) > assignmentDetailScore(early));
});
