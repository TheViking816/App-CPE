import assert from "node:assert/strict";
import test from "node:test";
import { hasAuthoritativeNoAssignments } from "../scripts/portal-assignment-empty.js";

test("cero contrataciones confirmadas no se considera fallo del portal", () => {
  assert.equal(hasAuthoritativeNoAssignments("No hay asignaciones para este trabajador"), true);
  assert.equal(hasAuthoritativeNoAssignments("Cargando asignaciones..."), false);
});
