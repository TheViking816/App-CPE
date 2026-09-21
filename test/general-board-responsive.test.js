import test from "node:test";
import assert from "node:assert/strict";

import { parseResponsiveBoardData } from "../scripts/general-board-responsive.js";

test("lee las tarjetas de la nueva Contratación Jornada y detecta Turno", () => {
  const result = parseResponsiveBoardData({
    title: "DIA: 11/09/2026 - JORNADA DE 08 A 14 H.",
    cards: [{
      parte: "26062",
      buque: "MSC CLAUDE GIRARDET",
      tipo: "",
      empresa: "MEDITERRANEAN SHIPPING C. TV",
      operacion: "CONT. C/SPREADER AUT",
      muelle: "FANGOS",
      especialidades: [
        { nombre: "CAPATAZ", solicitudes: "2", ceros: "0" },
        { nombre: "GRUAS", solicitudes: "2", ceros: "0" }
      ]
    }]
  });

  assert.equal(result.fecha, "11/09/2026");
  assert.equal(result.jornada, "08-14");
  assert.deepEqual(result.fuentes, ["turno"]);
  assert.deepEqual(result.bloques[0].especialidades, [
    { nombre: "CAPATAZ", solicitudes: 2, ceros: 0 },
    { nombre: "GRUAS", solicitudes: 2, ceros: 0 }
  ]);
});

test("un número de parte definitivo prevalece sobre la marca anticipada residual", () => {
  const result = parseResponsiveBoardData({
    title: "DIA: 12/09/2026 - JORNADA DE 20 A 02 H.",
    cards: [{
      parte: "26223",
      buque: "--",
      tipo: "ANTICIPADA",
      empresa: "SEVASA",
      operacion: "RESERVA III y IV",
      muelle: "-",
      especialidades: [{ nombre: "RESERVA G IV", solicitudes: "34", ceros: "0" }]
    }]
  });

  assert.deepEqual(result.fuentes, ["turno"]);
  assert.equal(result.bloques[0].parte, "26223");
  assert.equal(result.bloques[0].tipo, "turno");
});

test("mantiene anticipada mientras el portal todavía no publica un parte numérico", () => {
  const result = parseResponsiveBoardData({
    title: "DIA: 12/09/2026 - JORNADA DE 20 A 02 H.",
    cards: [{
      parte: "CONTRATACIÓN ANTICIPADA",
      tipo: "ANTICIPADA",
      empresa: "SEVASA",
      especialidades: [{ nombre: "RESERVA G IV", solicitudes: "34", ceros: "0" }]
    }]
  });

  assert.deepEqual(result.fuentes, ["anticipada"]);
  assert.equal(result.bloques[0].tipo, "anticipada");
});
