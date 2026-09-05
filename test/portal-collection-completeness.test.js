import test from "node:test";
import assert from "node:assert/strict";
import { containsAllSavedPortalRows } from "../scripts/portal-collection-completeness.js";

const official = [
  { dia: "01", parte: "25038", jornada: "DE 20 A 02 H.", produccion: "27.18 €" },
  { dia: "01", parte: "24979", jornada: "DE 08 A 14 H.", produccion: "93.80 €" },
  { dia: "02", parte: "25118", jornada: "DE 14 A 20 H.", produccion: "93.72 €" }
];

test("72635: una C/A fusionada no convierte en parcial la nueva lectura de jornales", () => {
  const saved = [...official, { dia: "05", parte: "C/A", jornada: "DE 14 A 20 H.", upcomingAssignment: true }];
  assert.equal(containsAllSavedPortalRows(official, saved), true);
});

test("72635: una C/A sin importe no cuenta como una prima oficial perdida", () => {
  const saved = [...official, { dia: "05", parte: "C/A", jornada: "DE 14 A 20 H.", produccion: "" }];
  assert.equal(containsAllSavedPortalRows(official, saved, { premiumOnly: true }), true);
  assert.equal(containsAllSavedPortalRows(official.slice(1), saved, { premiumOnly: true }), false);
});
