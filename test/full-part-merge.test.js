import test from "node:test";
import assert from "node:assert/strict";
import { fillMissingFullPartWorkerNames, findPartBolsaWorkers, formatFullPartWorkerCode, mergeFullPartSpecialties } from "../src/fullPartMerge.js";

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

test("completa el nombre de turno de una anticipada sin sustituir nombres publicados", () => {
  const specialties = [{ name: "TRASTAINERS RTT", workers: [
    { code: "72635", name: "" },
    { code: "72614", name: "Nombre oficial del parte" }
  ] }];
  const result = fillMissingFullPartWorkerNames(specialties, new Map([
    ["72635", "Trabajador del directorio"],
    ["72614", "Nombre antiguo"]
  ]));
  assert.equal(result[0].workers[0].name, "Trabajador del directorio");
  assert.equal(result[0].workers[1].name, "Nombre oficial del parte");
});

test("elimina el total general y los bloques repetidos sin alterar el orden oficial", () => {
  const gruas = {
    name: "GRUAS",
    requested: 5,
    workers: ["71428", "71766", "71192", "71445", "71948"].map((code) => ({ code, name: `Trabajador ${code}` })),
    bolsa: 0,
    unnamed: 0,
  };
  const conductores = {
    name: "CONDUCTOR 1a",
    requested: 59,
    workers: Array.from({ length: 59 }, (_, index) => ({ code: `72${String(index).padStart(3, "0")}`, name: `Conductor ${index + 1}` })),
    bolsa: 0,
    unnamed: 0,
  };
  const result = mergeFullPartSpecialties([
    { name: "Trabajadores", requested: 64, workers: [], bolsa: 0, unnamed: 64 },
    gruas,
    structuredClone(gruas),
    conductores,
    structuredClone(conductores),
  ], []);

  assert.equal(result.reduce((total, specialty) => total + specialty.requested, 0), 64);
  assert.deepEqual(result.map((specialty) => specialty.name), ["GRUAS", "CONDUCTOR 1a"]);
  assert.deepEqual(result[0].workers.map((worker) => worker.code), ["71428", "71766", "71192", "71445", "71948"]);
});

test("usa el orden oficial de especialidades y nunca suma dos lecturas del mismo bloque", () => {
  const specialty = (name, requested, codes) => ({
    name,
    requested,
    workers: codes.map((code) => ({ code, name: `Trabajador ${code}` })),
    bolsa: 0,
    unnamed: 0,
  });
  const result = mergeFullPartSpecialties([
    specialty("CONDUCTOR 1a", 2, ["72679", "72744"]),
    specialty("GRUAS", 2, ["71445", "71948"]),
    specialty("SOBORDISTA", 2, ["24011", "24016"]),
    specialty("CAPATAZ", 2, ["24227", "24229"]),
    specialty("GRUAS", 2, ["71948", "71445"]),
    specialty("CLASIFICADOR", 1, ["63186"]),
  ], []);

  assert.deepEqual(result.map(({ name, requested }) => ({ name, requested })), [
    { name: "CAPATAZ", requested: 2 },
    { name: "SOBORDISTA", requested: 2 },
    { name: "CLASIFICADOR", requested: 1 },
    { name: "GRUAS", requested: 2 },
    { name: "CONDUCTOR 1a", requested: 2 },
  ]);
  assert.deepEqual(result[3].workers.map((worker) => worker.code), ["71445", "71948"]);
});
