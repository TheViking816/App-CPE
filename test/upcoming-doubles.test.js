import assert from "node:assert/strict";
import test from "node:test";
import { groupUpcomingDoubles, markGrantedUpcomingDoubles, upcomingDoubleDayLabel } from "../src/upcomingDoubles.js";

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

test("marca como concedida la especialidad contratada para la misma fecha y jornada", () => {
  const rows = markGrantedUpcomingDoubles([
    { date: "20/09/2026", specialty: "22 - TRASTAINERS RTT", journey: "20/02" },
    { date: "20/09/2026", specialty: "10 - TRINCADOR", journey: "20/02" },
    { date: "20/09/2026", specialty: "03 - ESPECIALISTA", journey: "02/08" }
  ], [
    { fecha: "20/09/2026", especialidad: "TRASTAINERS RTT", jornada: "DE 20 A 02 H.", parte: "26481" }
  ]);

  assert.equal(rows[0].granted, true);
  assert.equal(rows[0].grantedAssignment.parte, "26481");
  assert.equal(rows[1].granted, undefined);
  assert.equal(rows[2].granted, undefined);
});

test("no concede un doble si solo coincide la fecha pero no la jornada", () => {
  const [row] = markGrantedUpcomingDoubles([
    { date: "20/09/2026", specialty: "22 - TRASTAINERS RTT", journey: "20/02" }
  ], [
    { fecha: "20/09/2026", especialidad: "TRASTAINERS RTT", jornada: "DE 14 A 20 H." }
  ]);

  assert.equal(row.granted, undefined);
});
