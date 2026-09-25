import assert from "node:assert/strict";
import test from "node:test";
import {
  hasCurrentRestMonthWindow,
  mergeRestWorkerMetadata,
  parseDescansos,
  restMonthWindow,
  selectCurrentRestMonths
} from "../scripts/sync-portal-oficial.js";

function restLink(year, month, day, code = "DS") {
  return `<a href="javascript:selFecha(${year},${month},${day})">${code}</a>`;
}

test("guarda el grupo profesional del portal separado del grupo de descanso", () => {
  const parsed = parseDescansos([
    "<div>Grupo Profesional: (SIN-F ) - Pend. De FORMACION<br>Grupo de Descanso 2024: A - V</div>",
    restLink(2026, 9, 24), restLink(2026, 10, 2)
  ].join(""), new Date("2026-09-23T12:00:00.000Z"));
  assert.equal(parsed.worker.professionalGroup, "(SIN-F ) - Pend. De FORMACION");
  assert.equal(parsed.worker.group, "A - V");
});

test("conserva el grupo profesional RTT sin mezclarlo con el de descanso", () => {
  const parsed = parseDescansos([
    "<div>Grupo Profesional: (G-DA ) - solo RTT<br>Grupo de Descanso 2024: C - N</div>",
    restLink(2026, 9, 24), restLink(2026, 10, 2)
  ].join(""), new Date("2026-09-23T12:00:00.000Z"));
  assert.equal(parsed.worker.professionalGroup, "(G-DA ) - solo RTT");
  assert.equal(parsed.worker.group, "C - N");
});

test("al cambiar de agosto a septiembre publica septiembre y octubre", () => {
  const now = new Date("2026-09-02T00:30:00.000Z");
  const parsed = parseDescansos([
    restLink(2026, 8, 31),
    restLink(2026, 9, 1),
    restLink(2026, 10, 2)
  ].join(""), now);

  assert.deepEqual(parsed.months.map(({ year, month }) => [year, month]), [
    [2026, 9],
    [2026, 10]
  ]);
  assert.equal(hasCurrentRestMonthWindow(parsed, now), true);
});

test("VA prevalece sobre un SL duplicado para la misma fecha", () => {
  const now = new Date("2026-09-16T10:00:00.000Z");
  const parsed = parseDescansos([
    restLink(2026, 9, 21, "VA"),
    restLink(2026, 9, 21, "SL"),
    restLink(2026, 10, 1, "DS")
  ].join(""), now);

  const september = parsed.months.find(({ year, month }) => year === 2026 && month === 9);
  assert.equal(september.days.find(({ day }) => day === 21).code, "VA");
});

test("IT se guarda como estado válido y completa la ventana mensual", () => {
  const now = new Date("2026-09-21T12:00:00.000Z");
  const parsed = parseDescansos([
    restLink(2026, 9, 20, "IT"),
    restLink(2026, 10, 1, "IT")
  ].join(""), now);

  assert.equal(hasCurrentRestMonthWindow(parsed, now), true);
  assert.equal(parsed.months[0].days.find(({ day }) => day === 20).code, "IT");
  assert.equal(parsed.months[1].days.find(({ day }) => day === 1).code, "IT");
  assert.equal(parsed.totals.IT, 2);
});

test("FM se guarda junto a IT sin perder los grupos del trabajador", () => {
  const parsed = parseDescansos([
    "<div>Grupo Profesional: (G-DA ) - solo RTT<br>Grupo de Descanso 2026: C - N</div>",
    restLink(2026, 9, 21, "FM"),
    restLink(2026, 9, 22, "IT"),
    restLink(2026, 10, 1, "DS")
  ].join(""), new Date("2026-09-25T10:00:00.000Z"));

  assert.equal(parsed.worker.professionalGroup, "(G-DA ) - solo RTT");
  assert.equal(parsed.worker.group, "C - N");
  assert.equal(parsed.months[0].days[20].code, "FM");
  assert.equal(parsed.months[0].days[21].code, "IT");
});

test("una lectura parcial no borra los grupos confirmados previamente", () => {
  assert.deepEqual(mergeRestWorkerMetadata(
    { name: "", group: "B - N", professionalGroup: "" },
    { name: "Nombre anterior", group: "A - V", professionalGroup: "GRUPO III" }
  ), { name: "Nombre anterior", group: "B - N", professionalGroup: "GRUPO III" });
});

test("no acepta como completa una lectura antigua de agosto y septiembre", () => {
  const now = new Date("2026-09-02T00:30:00.000Z");
  const months = [
    { year: 2026, month: 8 },
    { year: 2026, month: 9 }
  ];

  assert.deepEqual(selectCurrentRestMonths(months, now), [{ year: 2026, month: 9 }]);
  assert.equal(hasCurrentRestMonthWindow({ months }, now), false);
});

test("el siguiente mes cruza correctamente de diciembre a enero", () => {
  const now = new Date("2026-12-15T12:00:00.000Z");
  assert.deepEqual(restMonthWindow(now), [
    { year: 2026, month: 12 },
    { year: 2027, month: 1 }
  ]);
});
