import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNorayPilotSnapshot, compareNorayPilotSnapshots } from '../scripts/noray-personal-pilot-data.js';
import { mergeNorayPilotSalary, norayPilotCalendar } from '../src/norayPilot.js';
import { packManualNotes } from '../src/manualMetadata.js';
import { calendarJornales } from '../src/calendarJornales.js';

function fixture(chapa = '72683') {
  return buildNorayPilotSnapshot({
    chapa, year: 2026, month: 10, updatedAt: '2026-10-24T06:00:00Z',
    base: { jornales: [{ numero: 1, parte: 30767, dia: 24, jornada: '02-08', especialidad: 'CONDUCTOR 1a', buque: 'MSC RIDA VIII', empresa: 'MSC' }] },
    vigentes: { jornales: [] },
    restHeader: { nombre_mes_actual: 'Octubre', fs_mes: { consumidos: 2, maximo: 10 }, fs_anyo: { consumidos: 7, maximo: 10 }, descansos_mes_actual: { actual: 7, minimo: 5, maximo: 6 } },
    restMonth: { anyo: 2026, mes: 10, dias: [{ dia: 24, codigo: 'DS' }, { dia: 25, codigo: '' }] },
    worker: { grupo_descanso_vac: 'A', grupo_descanso_sem: 'V' },
    vacationSummary: { anyo: 2026, periodos: [{ fecha_inicio: '2026-10-25', fecha_fin: '2026-10-26', dias: 2 }] }
  });
}

test('piloto 72683 conserva cabecera, calendario y periodos de vacaciones', () => {
  const pilot = fixture();
  assert.equal(pilot.rests.header.groupVacation, 'A');
  assert.deepEqual(pilot.rests.header.fsMonth, { used: 2, max: 10 });
  assert.deepEqual(pilot.rests.header.month, { name: 'Octubre', current: 7, min: 5, max: 6 });
  const calendar = norayPilotCalendar(pilot);
  assert.equal(calendar.officialDays['2026-10-24'], 'DS');
  assert.equal(calendar.officialDays['2026-10-25'], 'VA');
  assert.equal(calendar.officialDays['2026-10-26'], 'VA');
  assert.equal(calendar.vacationPeriods.length, 1);
  assert.equal(fixture('72584').chapa, '72584');
  assert.throws(() => buildNorayPilotSnapshot({ chapa: 'invalid' }), /Chapa no válida/);
});

test('repetir la extracción no crea nuevos cambios y el cambio de mes sí', () => {
  const pilot = fixture();
  assert.deepEqual(compareNorayPilotSnapshots(pilot, pilot), { newJournals: 0, changedRestDays: 0, newVacationPeriods: 0 });
  const nextMonth = { ...pilot, journals: { ...pilot.journals, month: 11 } };
  assert.equal(compareNorayPilotSnapshots(pilot, nextMonth).newJournals, 1);
});

test('historial previo intacto; jornal manual del mismo parte prevalece', () => {
  const pilot = fixture();
  const existing = { payload: { jornales: { history: [{ year: 2026, month: 9, rows: [{ parte: '100' }] }] }, other: 'preserved' } };
  const manual = [{ work_date: '2026-10-24', shift: '02-08', specialty: 'CONDUCTOR 1a', vessel: 'MSC RIDA VIII', notes: packManualNotes({ part: '30767' }) }];
  const merged = mergeNorayPilotSalary(existing, manual, pilot);
  assert.equal(merged.payload.jornales.history.length, 2);
  assert.equal(merged.payload.jornales.history[0].rows[0].parte, '100');
  assert.equal(merged.payload.jornales.history[1].rows.length, 0);
  assert.equal(merged.payload.other, 'preserved');
  assert.equal(mergeNorayPilotSalary(existing, [], pilot).payload.jornales.rows.length, 1);
});

test('el calendario recibe los mismos jornales que el Sueldómetro', () => {
  const pilot = fixture();
  const salary = mergeNorayPilotSalary(null, [], pilot);
  assert.deepEqual(calendarJornales(salary)['2026-10-24'], ['02-08']);
});
