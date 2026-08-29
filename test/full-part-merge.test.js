import test from "node:test";
import assert from "node:assert/strict";
import { findPartBolsaWorkers, formatFullPartWorkerCode, mergeFullPartSpecialties } from "../src/fullPartMerge.js";

test("App CPE sustituye los ocho ceros del parte 24721 por la bolsa", () => {
  const fixed = Array.from({ length: 7 }, (_, index) => ({ code: `N72${680 + index}`, name: `Turno ${index + 1}` }));
  const zeros = Array.from({ length: 8 }, () => ({ code: "C00000", name: "CERO" }));
  const bolsa = ["539", "682", "200", "248", "735", "802", "720", "804"].map((code) => ({
    code,
    name: "",
    puesto: "Conductor de 1a",
  }));
  const result = mergeFullPartSpecialties([{
    name: "CONDUCTOR 1a", requested: 15, workers: [...fixed, ...zeros], bolsa: 0, unnamed: 0,
  }], bolsa);

  assert.equal(result.length, 1);
  assert.equal(result[0].name, "CONDUCTOR 1a");
  assert.equal(result[0].requested, 15);
  assert.equal(result[0].workers.length, 15);
  assert.equal(result[0].workers.some((worker) => worker.code === "C00000"), false);
  assert.deepEqual(result[0].workers.slice(-8).map((worker) => worker.code), [
    "80539", "80682", "80200", "80248", "80735", "80802", "80720", "80804",
  ]);
  assert.equal(result[0].workers.slice(-8).every((worker) => worker.name === ""), true);
});

test("localiza solo la bolsa del mismo parte, fecha y jornada y conserva su nombre", () => {
  const conductor = { name: "Conductor de 1a", bolsa: [{ chapa: "539", name: "Trabajador conocido" }] };
  const group = { parte: "24721", specialties: new Map([["CONDUCTOR 1A", conductor]]) };
  const company = { groups: new Map([["parte:24721", group]]) };
  const board = { journeys: [{ fecha: "2026-08-29", jornada: "20-02", companies: new Map([["APM", company]]) }] };

  assert.deepEqual(findPartBolsaWorkers(board, { parte: "24721", fecha: "29/08/2026", jornada: "DE 20 A 02 H." }), [
    { code: "80539", name: "Trabajador conocido", puesto: "Conductor de 1a" },
  ]);
  assert.deepEqual(findPartBolsaWorkers(board, { parte: "24721", fecha: "29/08/2026", jornada: "14-20" }), []);
});

test("formatea las chapas cortas de bolsa y conserva las chapas de turno", () => {
  assert.equal(formatFullPartWorkerCode("539"), "80539");
  assert.equal(formatFullPartWorkerCode("80 682"), "80 682");
  assert.equal(formatFullPartWorkerCode("80682"), "80682");
  assert.equal(formatFullPartWorkerCode("N72683"), "N72683");
});
