import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { enrichJornales, summarizeAnnualPayroll } from "../src/payroll.js";

const journal = {
  jornal: "29",
  dia: "30",
  parte: "24721",
  jornada: "DE 20 A 02 H.",
  especialidad: "CONDUCTOR 1A",
  operacion: "CONT. C/SPREADER AUT"
};

function officialPremium(amount = "45,20") {
  return [{ parte: "24721", produccion: amount, produccionEstado: "verified" }];
}

test("una prima manual completa un jornal pendiente sin alterar la oficial", () => {
  const pending = enrichJornales([journal], [], "Agosto de 2026")[0];
  const manual = enrichJornales(
    [journal], [], "Agosto de 2026", null, {}, {},
    { [pending.payroll.manualPremiumKey]: { amount: 42.5, portalAmountAtEdit: null } }
  )[0];

  assert.equal(pending.payroll.portalPrima, null);
  assert.equal(manual.payroll.manualPrima, 42.5);
  assert.equal(manual.payroll.prima, 42.5);
  assert.equal(manual.payroll.primaSource, "manual");
  assert.equal(Number((manual.payroll.total - pending.payroll.total).toFixed(2)), 42.5);
});

test("la prima manual prevalece y avisa cuando el portal publica otro importe", () => {
  const official = enrichJornales([journal], officialPremium(), "Agosto de 2026")[0];
  const record = { amount: 42.5, portalAmountAtEdit: null };
  const manual = enrichJornales(
    [journal], officialPremium(), "Agosto de 2026", null, {}, {},
    { [official.payroll.manualPremiumKey]: record }
  )[0];

  assert.equal(manual.payroll.portalPrima, 45.2);
  assert.equal(manual.payroll.prima, 42.5);
  assert.equal(manual.payroll.manualPremiumConflict, true);
});

test("confirmar la diferencia evita avisos hasta que el portal vuelva a cambiar", () => {
  const preview = enrichJornales([journal], officialPremium(), "Agosto de 2026")[0];
  const records = { [preview.payroll.manualPremiumKey]: { amount: 42.5, portalAmountAtEdit: 45.2 } };
  const acknowledged = enrichJornales([journal], officialPremium(), "Agosto de 2026", null, {}, {}, records)[0];
  const changed = enrichJornales([journal], officialPremium("47,00"), "Agosto de 2026", null, {}, {}, records)[0];

  assert.equal(acknowledged.payroll.manualPremiumConflict, false);
  assert.equal(acknowledged.payroll.manualPremiumAcknowledged, true);
  assert.equal(changed.payroll.manualPremiumConflict, true);
  assert.equal(changed.payroll.portalPrima, 47);
  assert.equal(changed.payroll.prima, 42.5);
});

test("la prima manual también actualiza el resumen anual", () => {
  const preview = enrichJornales([journal], officialPremium(), "Agosto de 2026")[0];
  const annual = summarizeAnnualPayroll(
    [{ year: 2026, month: 8, monthLabel: "Agosto de 2026", rows: [journal] }],
    null,
    {},
    [],
    [{ year: 2026, month: 8, rows: officialPremium() }],
    {},
    { [preview.payroll.manualPremiumKey]: { amount: 42.5, portalAmountAtEdit: 45.2 } }
  );

  assert.equal(annual.months[0].enriched[0].payroll.portalPrima, 45.2);
  assert.equal(annual.months[0].enriched[0].payroll.prima, 42.5);
  assert.equal(annual.months[0].enriched[0].payroll.primaSource, "manual");
});

test("la persistencia es privada, por usuario y editable desde la modal", async () => {
  const [migration, client, app] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260830162513_add_manual_premium_adjustments.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/supabaseClient.js", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8")
  ]);

  assert.match(migration, /private\.app_cpe_manual_premiums/);
  assert.match(migration, /primary key \(user_id, jornal_key\)/);
  assert.match(migration, /app_cpe_user_from_token\(p_token\)/);
  assert.match(migration, /revoke all on table private\.app_cpe_manual_premiums from public, anon, authenticated/);
  assert.match(client, /app_cpe_get_manual_premiums/);
  assert.match(client, /app_cpe_set_manual_premium/);
  assert.match(app, /Guardar prima manual/);
  assert.match(app, /Mantener \{formatEuro\(payroll\.manualPrima\)\}/);
  assert.match(app, /Usar \$\{formatEuro\(payroll\.portalPrima\)\} del portal/);
});
