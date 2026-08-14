import test from "node:test";
import assert from "node:assert/strict";
import { defaultJourneyKey, expectedContractingSelection } from "../src/generalBoard.js";

test("selecciona la jornada esperada cuando ya está publicada", () => {
  const now = new Date("2026-08-14T10:00:00Z");
  const expected = expectedContractingSelection(now).key;
  const journeys = [{ key: "2026-08-14|02-08" }, { key: expected }, { key: "2026-08-14|20-02" }];
  assert.equal(defaultJourneyKey(journeys, now), expected);
});

test("muestra la última jornada disponible si la esperada sigue pendiente", () => {
  const now = new Date("2026-08-14T12:15:00Z");
  const journeys = [{ key: "2026-08-14|14-20" }, { key: "2026-08-14|20-02" }];
  assert.equal(defaultJourneyKey(journeys, now), "2026-08-14|20-02");
});

test("mantiene el estado vacío cuando todavía no existe ninguna jornada", () => {
  assert.equal(defaultJourneyKey([], new Date("2026-08-14T12:15:00Z")), "");
});
