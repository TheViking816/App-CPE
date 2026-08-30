import test from "node:test";
import assert from "node:assert/strict";
import { buildPortalNotifications } from "../scripts/portal-notifications.js";

const base = {
  sync: { inProgress: false },
  jornales: { rows: [{ dia: "30", parte: "24700", jornada: "DE 20 A 02 H.", especialidad: "CONDUCTOR 1a" }], monthLabel: "Agosto 2026" },
  primas: { recognized: true, locked: false, rows: [{ dia: "30", parte: "24700", jornada: "DE 20 A 02 H.", especialidad: "CONDUCTOR 1a", produccion: "30.00 €" }], monthLabel: "Agosto 2026" },
  nominas: { recognized: true, locked: false, rows: [{ id: "07/26-Mensual", title: "Mensual 07/26", period: "07/26" }] },
  descansos: { months: [{ year: 2026, month: 8, days: [{ day: 30, code: "DS" }] }] },
  vacaciones: { recognized: true, rows: [{ inicio: "01/09/2026", fin: "07/09/2026", dias: 7 }] },
  excepciones: { recognized: true, rows: [{ date: "2026-09-03", shift: "DE 08 A 14 H.", status: "Pendiente", used: false }] }
};

test("no crea novedades en la primera lectura ni durante progreso", () => {
  assert.deepEqual(buildPortalNotifications(null, base), []);
  assert.deepEqual(buildPortalNotifications(base, { ...base, sync: { inProgress: true } }), []);
});

test("detecta solo los siete tipos permitidos e impide duplicados conceptuales", () => {
  const next = structuredClone(base);
  next.jornales.rows.push({ dia: "31", parte: "24817", jornada: "DE 02 A 08 H.", especialidad: "CONDUCTOR 1a" });
  next.primas.rows[0].produccion = "38.20 €";
  next.primas.rows.push({ dia: "31", parte: "24817", jornada: "DE 02 A 08 H.", especialidad: "CONDUCTOR 1a", produccion: "18.50 €" });
  next.nominas.rows.push({ id: "08/26-Mensual", title: "Mensual 08/26", period: "08/26" });
  next.descansos.months[0].days[0].code = "SL";
  next.vacaciones.rows[0].fin = "08/09/2026";
  next.excepciones.rows[0].status = "Aceptada";

  const rows = buildPortalNotifications(base, next, { now: new Date("2026-08-30T12:00:00Z") });
  assert.deepEqual(new Set(rows.map((row) => row.eventType)), new Set([
    "new_journal", "new_premium", "premium_modified", "new_payroll",
    "rests_changed", "vacations_changed", "exceptions_changed"
  ]));
  assert.equal(rows.every((row) => row.changeHash.length === 64), true);
});

test("no convierte la carga de meses históricos en nuevos jornales", () => {
  const next = structuredClone(base);
  next.jornales.history = [{ monthLabel: "Enero 2026", rows: [{ dia: "10", parte: "20000", jornada: "DE 08 A 14 H.", especialidad: "CONDUCTOR 1a" }] }];
  const rows = buildPortalNotifications(base, next, { now: new Date("2026-08-30T12:00:00Z") });
  assert.equal(rows.some((row) => row.eventType === "new_journal"), false);
});
