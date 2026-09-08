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
  const rests = rows.find((row) => row.eventType === "rests_changed");
  assert.equal(rests.body, "30 agosto: DS → SL");
  assert.equal(rests.metadata.changeCount, 1);
  assert.equal(rests.metadata.changes[0].date, "2026-08-30");
});

test("resume hasta tres cambios de descanso y conserva el detalle completo", () => {
  const previous = structuredClone(base);
  const next = structuredClone(base);
  previous.descansos.months[0].days = [1, 2, 3, 4, 5].map((day) => ({ day, code: "SL" }));
  next.descansos.months[0].days = [1, 2, 3, 4, 5].map((day) => ({ day, code: "DS" }));

  const rest = buildPortalNotifications(previous, next).find((row) => row.eventType === "rests_changed");
  assert.equal(rest.body, "01 agosto: SL → DS · 02 agosto: SL → DS · 03 agosto: SL → DS · +2 cambios más");
  assert.equal(rest.metadata.changeCount, 5);
  assert.equal(rest.metadata.changes.length, 5);
});

test("el avance normal de la ventana mensual no se presenta como cambio de descansos", () => {
  const september = { year: 2026, month: 9, days: [{ day: 9, code: "DS" }] };
  const previous = structuredClone(base);
  const next = structuredClone(base);
  previous.descansos.months = [{ year: 2026, month: 8, days: [{ day: 30, code: "SL" }] }, september];
  next.descansos.months = [structuredClone(september), { year: 2026, month: 10, days: [{ day: 1, code: "DS" }] }];

  const rows = buildPortalNotifications(previous, next);
  assert.equal(rows.some((row) => row.eventType === "rests_changed"), false);
});

test("no convierte la carga de meses históricos en nuevos jornales", () => {
  const next = structuredClone(base);
  next.jornales.history = [{ monthLabel: "Enero 2026", rows: [{ dia: "10", parte: "20000", jornada: "DE 08 A 14 H.", especialidad: "CONDUCTOR 1a" }] }];
  const rows = buildPortalNotifications(base, next, { now: new Date("2026-08-30T12:00:00Z") });
  assert.equal(rows.some((row) => row.eventType === "new_journal"), false);
});

test("una pantalla intermedia de excepciones sin cargar no crea una novedad", () => {
  const next = structuredClone(base);
  next.excepciones = { recognized: false, rows: [] };
  const rows = buildPortalNotifications(base, next);
  assert.equal(rows.some((row) => row.eventType === "exceptions_changed"), false);
});

test("no repite un jornal cuando el portal completa el parte, tipo o formato de especialidad", () => {
  const previous = structuredClone(base);
  previous.jornales = {
    monthLabel: "Septiembre de 2026",
    rows: [{ dia: "01", parte: "CONTRATACIÓN ANTICIPADA", jornada: "DE 02 A 08 H.", especialidad: "CONDUCTOR 1A", tipo: "" }]
  };
  const next = structuredClone(previous);
  next.jornales.rows = [{ dia: "01", parte: "24943", jornada: "DE 02 A 08 H.", especialidad: "CONDUCTOR 1a", tipo: "TUR" }];

  const rows = buildPortalNotifications(previous, next, { now: new Date("2026-09-01T00:00:00Z") });
  assert.equal(rows.some((row) => row.eventType === "new_journal"), false);
});
