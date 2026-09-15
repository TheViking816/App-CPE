import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("el modal nuevo gana el empate frente a la tabla antigua para conservar el orden oficial", () => {
  const source = fs.readFileSync(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");
  assert.match(source, /assignmentDetailScore\(fromText\)\s*>=\s*assignmentDetailScore\(fromTable\)/);
});
