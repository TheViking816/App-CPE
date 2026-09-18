import assert from "node:assert/strict";
import test from "node:test";
import { groupUpcomingDoubles, upcomingDoubleDayLabel } from "../src/upcomingDoubles.js";

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
