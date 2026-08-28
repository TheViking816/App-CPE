import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { enrichJornales, getRemateGroup, getRemateRate } from "../src/payroll.js";

const journal = {
  dia: "28",
  parte: "R-100",
  jornada: "DE 02 A 08 H.",
  especialidad: "ESPECIALISTA",
  operacion: "CONT. C/SPREADER AUT"
};

test("clasifica los cuatro grupos de remate", () => {
  assert.equal(getRemateGroup("Especialista"), "I");
  assert.equal(getRemateGroup("Trincador"), "I");
  assert.equal(getRemateGroup("Grúa containers"), "II");
  assert.equal(getRemateGroup("Clasificador"), "III");
  assert.equal(getRemateGroup("Sobordista"), "IV");
  assert.equal(getRemateGroup("Capataz"), "IV");
});

test("lee los importes horarios de la tabla salarial", () => {
  assert.deepEqual(getRemateRate("2026-08-28", "02-08", "ESPECIALISTA"), {
    group: "I", rateKey: "LABORABLE", amount: 63.06
  });
  assert.equal(getRemateRate("2026-08-28", "02-08", "MANIPULADOR")?.amount, 65.11);
  assert.equal(getRemateRate("2026-08-28", "02-08", "CLASIFICADOR")?.amount, 67.5);
  assert.equal(getRemateRate("2026-08-28", "02-08", "CAPATAZ")?.amount, 71.46);
  assert.equal(getRemateRate("2026-08-29", "14-20", "TRINCADOR")?.amount, 80.49);
  assert.equal(getRemateRate("2026-08-15", "08-14", "CAPATAZ")?.amount, 87.8);
});

test("el remate es opcional y suma una o dos horas al total", () => {
  const preview = enrichJornales([journal], [], "Agosto de 2026")[0];
  assert.equal(preview.payroll.remateEligible, true);
  assert.equal(preview.payroll.remate, 0);

  const oneHour = enrichJornales(
    [journal], [], "Agosto de 2026", null, {}, { [preview.payroll.remateKey]: 1 }
  )[0];
  const twoHours = enrichJornales(
    [journal], [], "Agosto de 2026", null, {}, { [preview.payroll.remateKey]: 2 }
  )[0];

  assert.equal(oneHour.payroll.remate, 63.06);
  assert.equal(twoHours.payroll.remate, 126.12);
  assert.equal(Number((oneHour.payroll.total - preview.payroll.total).toFixed(2)), 63.06);
  assert.equal(Number((twoHours.payroll.total - preview.payroll.total).toFixed(2)), 126.12);
});

test("la persistencia queda aislada por usuario y admite borrar con cero", async () => {
  const [migration, client, app] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260828004434_add_remate_hour_adjustments.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/supabaseClient.js", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8")
  ]);

  assert.match(migration, /primary key \(user_id, jornal_key\)/);
  assert.match(migration, /hours in \(1, 2\)/);
  assert.match(migration, /if v_hours > 0[\s\S]*insert into private\.app_cpe_remate_hours[\s\S]*else[\s\S]*delete from private\.app_cpe_remate_hours/);
  assert.match(client, /app_cpe_get_remate_hours/);
  assert.match(client, /app_cpe_set_remate_hours/);
  assert.match(app, /Remate opcional/);
  assert.match(app, /\[0, 1, 2\]\.map/);
});
