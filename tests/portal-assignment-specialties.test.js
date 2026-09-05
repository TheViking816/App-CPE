import test from "node:test";
import assert from "node:assert/strict";

import {
  assignmentDetailScore,
  uniqueAssignmentSpecialties
} from "../scripts/portal-assignments.js";

test("deduplica bloques responsive del mismo equipo aunque cambie el orden", () => {
  const first = {
    name: "CONDUCTOR 1a",
    requested: 2,
    bolsa: 0,
    unnamed: 0,
    workers: [{ code: "T72683", name: "Adrián" }, { code: "T71005", name: "Carolina" }]
  };
  const repeated = {
    ...first,
    workers: [...first.workers].reverse()
  };

  assert.deepEqual(uniqueAssignmentSpecialties([first, repeated]), [first]);
  assert.equal(
    assignmentDetailScore({ specialties: [first, repeated] }),
    assignmentDetailScore({ specialties: [first] })
  );
});
