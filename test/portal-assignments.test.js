import test from "node:test";
import assert from "node:assert/strict";
import {
  assignmentDetailScore,
  isAssignmentDetailComplete,
  parseAssignmentDetailFromTables
} from "../scripts/portal-assignments.js";

const detailTable = (workers) => [[
  ["Parte:", "12345"],
  ["CONDUCTOR 1a", "5", workers]
]];

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
