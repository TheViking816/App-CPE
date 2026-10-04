import assert from "node:assert/strict";
import test from "node:test";
import { groupUpcomingDoubles, markContractedUpcomingDoubles, upcomingDoubleDayLabel } from "../src/upcomingDoubles.js";

test("agrupa los dobles por día y conserva especialidad, jornada y festivo", () => {
  const firstDate = new Date(2026, 8, 19, 20);
  const secondDate = new Date(2026, 8, 20, 2);
  const groups = groupUpcomingDoubles([
    { date: "19/09/2026", specialty: "22 - TRASTAINERS RTT", journey: "20/02", startsAt: firstDate },
    { date: "19/09/2026", specialty: "10 - TRINCADOR", journey: "20/02", startsAt: firstDate },
    { date: "20/09/2026", specialty: "03 - ESPECIALISTA", journey: "02/08", startsAt: secondDate, holiday: true }
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].dateKey, "19/09/2026");
  assert.deepEqual(groups[0].requests.map(({ specialty, journey }) => [specialty, journey]), [
    ["22 - TRASTAINERS RTT", "20/02"],
    ["10 - TRINCADOR", "20/02"]
  ]);
  assert.equal(groups[1].holiday, true);
});

test("identifica hoy, mañana y el día de la semana", () => {
  const now = new Date(2026, 8, 19, 12);
  assert.equal(upcomingDoubleDayLabel(new Date(2026, 8, 19, 20), now), "Hoy");
  assert.equal(upcomingDoubleDayLabel(new Date(2026, 8, 20, 2), now), "Mañana");
  assert.equal(upcomingDoubleDayLabel(new Date(2026, 8, 21, 8), now), "Lunes");
});

test("corrige el indicador festivo de snapshots antiguos en la vista", () => {
  const groups = groupUpcomingDoubles([9, 10, 11, 12].map((day) => ({
    date: `${String(day).padStart(2, "0")}/10/2026`,
    startsAt: new Date(2026, 9, day, 20),
    holiday: day === 10 || day === 11
  })));
  assert.deepEqual(groups.map(({ dateKey, holiday }) => [dateKey, holiday]), [
    ["09/10/2026", true],
    ["10/10/2026", false],
    ["11/10/2026", true],
    ["12/10/2026", true]
  ]);
});

test("marca como contratada la especialidad asignada para la misma fecha y jornada", () => {
  const rows = markContractedUpcomingDoubles([
    { date: "20/09/2026", specialty: "22 - TRASTAINERS RTT", journey: "20/02" },
    { date: "20/09/2026", specialty: "10 - TRINCADOR", journey: "20/02" },
    { date: "20/09/2026", specialty: "03 - ESPECIALISTA", journey: "02/08" }
  ], [
    { fecha: "20/09/2026", especialidad: "TRASTAINERS RTT", jornada: "DE 20 A 02 H.", parte: "26481" }
  ]);

  assert.equal(rows[0].contracted, true);
  assert.equal(rows[0].contractedAssignment.parte, "26481");
  assert.equal(rows[1].contracted, undefined);
  assert.equal(rows[2].contracted, undefined);
  assert.equal(groupUpcomingDoubles(rows)[0].contractedCount, 1);
});

test("no marca contratado un doble si solo coincide la fecha pero no la jornada", () => {
  const [row] = markContractedUpcomingDoubles([
    { date: "20/09/2026", specialty: "22 - TRASTAINERS RTT", journey: "20/02" }
  ], [
    { fecha: "20/09/2026", especialidad: "TRASTAINERS RTT", jornada: "DE 14 A 20 H." }
  ]);

  assert.equal(row.contracted, undefined);
});
