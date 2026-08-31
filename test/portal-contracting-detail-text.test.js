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
