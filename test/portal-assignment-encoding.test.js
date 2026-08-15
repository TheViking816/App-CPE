import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAssignmentsFromTables,
  repairPortalEncoding
} from "../scripts/portal-assignments.js";

test("repara caracteres UTF-8 interpretados como Windows-1252", () => {
  assert.equal(repairPortalEncoding("CONTRATACIÃ“N ANTICIPADA"), "CONTRATACIÓN ANTICIPADA");
});

test("normaliza la codificacion de los proximos jornales al leer el portal", () => {
  const parsed = parseAssignmentsFromTables([[ 
    ["Parte:", "CONTRATACIÃ“N ANTICIPADA", "Fecha:", "17/08/2026", "Jornada:", "DE 08 A 14 H."]
  ]]);

  assert.equal(parsed.rows[0].parte, "CONTRATACIÓN ANTICIPADA");
});
