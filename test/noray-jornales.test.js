import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeNorayJornales,
  mergeNorayLiquidations,
  norayHistoryWindow,
  norayObservation,
  norayPremium,
  normalizeNorayDate,
  normalizeNorayShift,
  previousMonths,
  sanitizeNorayPartDetail
} from "../scripts/noray-jornales.js";

test("normalizes Noray dates and shifts", () => {
  assert.equal(normalizeNorayDate("20260901"), "2026-09-01");
  assert.equal(normalizeNorayDate("1/9/2026"), "2026-09-01");
  assert.equal(normalizeNorayDate("1", 2026, 9), "2026-09-01");
  assert.equal(normalizeNorayShift("DE 02 A 08 H."), "0208");
});

test("reads only positive official productivity and preserves provisional state", () => {
  assert.deepEqual(norayPremium({ produccion_cpe: 75.48, en_historico: false }), {
    amount: 75.48,
    status: "pending"
  });
  assert.deepEqual(norayPremium({ produccion_cap: "95,40", en_historico: true }), {
    amount: 95.4,
    status: "verified"
  });
  assert.equal(norayPremium({ produccion_cpe: 0 }), null);
});

test("merges vigente and historical rows plus in-progress liquidations", () => {
  const merged = mergeNorayJornales(
    [{ anyo: 2026, parte: 24943, fecha: "20260901", liquidacion: null }],
    [{ anyo: 2026, parte: 24943, fecha: "20260901", buque: "MSC LAGOS X" }]
  );
  const withLiquidation = mergeNorayLiquidations(merged, [{
    anyo: 2026,
    parte: 24943,
    liquidacion: { produccion_cpe: 75.48, en_historico: false }
  }], 2026);
  assert.equal(withLiquidation.length, 1);
  assert.equal(withLiquidation[0].buque, "MSC LAGOS X");
  assert.equal(withLiquidation[0].liquidacion.produccion_cpe, 75.48);
});

test("sanitizes complete part teams and identifies bolsa workers", () => {
  const detail = sanitizeNorayPartDetail({
    fecha: "20260901",
    jornada: "DE 02 A 08 H.",
    empresa: "CSP",
    grupos: [{
      especialidad: "ESPECIALISTA",
      solicitados: 2,
      trabajadores: [
        { chapa: "80774", nombre: "MIGUEL MASÓ CAMPOS", tipo: "bsa", categoria: "BOLSA" },
        { chapa: "72683", nombre: "ADRIAN LUJAN MARIN", tipo: "NUD", categoria: "SVS" }
      ]
    }]
  }, { parte: "24943" });
  assert.equal(detail.recognized, true);
  assert.equal(detail.specialties[0].workers[0].code, "80774");
  assert.equal(detail.specialties[0].workers[0].category, "BOLSA");
});

test("builds an observation only after exact date part and shift matching", () => {
  const observed = norayObservation({
    parte: 24943,
    fecha: "20260901",
    jornada: "DE 02 A 08 H.",
    especialidad: "ESPECIALISTA",
    liquidacion: { produccion_cpe: 75.48, en_historico: true }
  }, { grupos: [{ especialidad: "ESPECIALISTA", solicitados: 1, trabajadores: [{ chapa: "80774", nombre: "MIGUEL" }] }] }, {
    sourceChapa: "72683",
    registro: 1234,
    year: 2026,
    month: 9,
    premiumsVerified: true,
    observedAt: "2026-09-12T06:00:00.000Z"
  });
  assert.equal(observed.jornada_key, "0208");
  assert.equal(observed.premium_amount, 75.48);
  assert.equal(observed.premium_status, "verified");

  const locked = norayObservation({ ...observed, liquidacion: { produccion_cpe: 99 } }, null, {
    sourceChapa: "72683", registro: 1234, year: 2026, month: 9,
    premiumsVerified: false, observedAt: "2026-09-12T06:00:00.000Z"
  });
  assert.equal(locked.premium_amount, null);
});

test("builds live Jornales observations when the API returns dia instead of fecha", () => {
  const observed = norayObservation({
    parte: 24943,
    anyo: 2026,
    dia: 1,
    jornada: "DE 02 A 08 H.",
    especialidad: "CONDUCTOR 1a",
    liquidacion: { produccion_cpe: 95.4, en_historico: true }
  }, null, {
    sourceChapa: "72683",
    registro: 1234,
    year: 2026,
    month: 9,
    premiumsVerified: true,
    observedAt: "2026-09-12T06:00:00.000Z"
  });

  assert.equal(observed.fecha, "2026-09-01");
  assert.equal(observed.jornada_key, "0208");
  assert.equal(observed.premium_amount, 95.4);
});

test("preserves a part detail that was already sanitized by the collector", () => {
  const detail = {
    recognized: true,
    parte: "24943",
    fecha: "20260901",
    jornada: "DE 02 A 08 H.",
    specialties: [{
      name: "ESPECIALISTA",
      workers: [{ code: "80774", name: "MIGUEL MASÓ CAMPOS", category: "BOLSA" }]
    }]
  };
  const observed = norayObservation({
    parte: 24943,
    dia: 1,
    jornada: "DE 02 A 08 H.",
    especialidad: "CONDUCTOR 1a"
  }, detail, {
    sourceChapa: "72683", registro: 1234, year: 2026, month: 9,
    premiumsVerified: false, observedAt: "2026-09-12T06:00:00.000Z"
  });

  assert.equal(observed.part_detail.specialties[0].workers[0].code, "80774");
});

test("builds a bounded historical month window", () => {
  assert.deepEqual(previousMonths(3, new Date("2026-01-15T00:00:00Z")), [
    { year: 2026, month: 1 },
    { year: 2025, month: 12 },
    { year: 2025, month: 11 }
  ]);
  assert.equal(previousMonths(100).length, 24);
});

test("uses twelve months only for an initial load and two for routine updates", () => {
  assert.equal(norayHistoryWindow("", false), 12);
  assert.equal(norayHistoryWindow("", true), 2);
  assert.equal(norayHistoryWindow("12", true), 12);
  assert.equal(norayHistoryWindow("1", false), 1);
});
