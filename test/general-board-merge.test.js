import test from "node:test";
import assert from "node:assert/strict";

import { mergeGeneralBoardJourney } from "../scripts/general-board-merge.js";

const mergeBlocks = (previous, current) => [...previous, ...current];

test("Turno sustituye por completo la anticipada anterior de la misma jornada", () => {
  const result = mergeGeneralBoardJourney(
    { fuentes: ["anticipada"], bloques: [{ parte: "CONTRATACION ANTICIPADA" }] },
    { fuentes: ["turno"], bloques: [{ parte: "24001" }] },
    mergeBlocks
  );

  assert.deepEqual(result.fuentes, ["turno"]);
  assert.deepEqual(result.bloques, [{ parte: "24001" }]);
});

test("mantiene y combina anticipadas mientras todavia no existe Turno", () => {
  const result = mergeGeneralBoardJourney(
    { fuentes: ["anticipada"], bloques: [{ parte: "CA-1" }] },
    { fuentes: ["anticipada"], bloques: [{ parte: "CA-2" }] },
    mergeBlocks
  );

  assert.deepEqual(result.fuentes, ["anticipada"]);
  assert.deepEqual(result.bloques, [{ parte: "CA-1" }, { parte: "CA-2" }]);
});
