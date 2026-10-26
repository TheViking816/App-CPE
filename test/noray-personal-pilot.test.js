import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNorayPilotSnapshot, compareNorayPilotSnapshots } from '../scripts/noray-personal-pilot-data.js';
import { mergeNorayPilotSalary, norayPilotCalendar } from '../src/norayPilot.js';
import { buildManualSalaryMonths } from '../src/manualSalary.js';
import { enrichJornales } from '../src/payroll.js';
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

test('un jornal manual conserva su turno aunque el portal traiga otro puesto o varios partes', () => {
  const pilot = fixture('72668');
  pilot.journals.rows.push({ ...pilot.journals.rows[0], parte: '30768', buque: 'OTRO BUQUE', especialidad: 'CLASIFICADOR' });
  const manual = [{ work_date: '2026-10-24', shift: '02-08', specialty: 'CONDUCTOR 2a',
    notes: packManualNotes({ company: 'MSC' }) }];
  const merged = mergeNorayPilotSalary(null, manual, pilot);
  assert.equal(merged.payload.jornales.rows.length, 0);
  assert.deepEqual(calendarJornales(merged, manual)['2026-10-24'], ['02-08']);
  assert.equal(mergeNorayPilotSalary(null, [{ ...manual[0], shift: '14-20' }], pilot).payload.jornales.rows.length, 1);
});

test('la fecha y el turno identifican el jornal aunque cambie el buque', () => {
  const pilot = fixture();
  const manual = [{ work_date: '2026-10-24', shift: '02-08', specialty: 'CLASIFICADOR',
    notes: packManualNotes({ vessel: 'OTRO BUQUE', part: '99999' }) }];
  assert.equal(mergeNorayPilotSalary(null, manual, pilot).payload.jornales.rows.length, 0);
});

test('el calendario recibe los mismos jornales que el Sueldómetro', () => {
  const pilot = fixture();
  const salary = mergeNorayPilotSalary(null, [], pilot);
  assert.deepEqual(calendarJornales(salary)['2026-10-24'], ['02-08']);
});

test('la prima leída completa el jornal vacío y conserva la introducida por el usuario', () => {
  const pilot = fixture();
  const premiumPilot = { schemaVersion: 1, chapa: '72683', year: 2026, month: 10,
    rows: [{ part: '30767', date: '2026-10-24', shift: '02-08', amount: 169.96, status: 'pending' }] };
  const pending = { id: 1, work_date: '2026-10-24', shift: '02-08', specialty: 'CONDUCTOR 1a',
    worker_group: 'II', operation_type: 'SP', premium: 0,
    notes: packManualNotes({ part: '30767', premiumKnown: false }) };
  const imported = mergeNorayPilotSalary(null, [pending], pilot, premiumPilot);
  const first = buildManualSalaryMonths(imported, [pending])[0].items[0];
  assert.equal(first.payroll.prima, 169.96);
  assert.equal(first.payroll.primaSource, 'portal');
  const own = { ...pending, premium: 25, notes: packManualNotes({ part: '30767', premiumKnown: true }) };
  const second = buildManualSalaryMonths(mergeNorayPilotSalary(null, [own], pilot, premiumPilot), [own])[0].items[0];
  assert.equal(second.payroll.prima, 25);
  assert.equal(second.payroll.primaSource, 'manual');
  const ownZero = { ...pending, premium: 0, notes: packManualNotes({ part: '30767', premiumKnown: true }) };
  const third = buildManualSalaryMonths(mergeNorayPilotSalary(null, [ownZero], pilot, premiumPilot), [ownZero])[0].items[0];
  assert.equal(third.payroll.prima, 0);
  assert.equal(third.payroll.primaSource, 'manual');
  const historic = buildManualSalaryMonths(mergeNorayPilotSalary(null, [], pilot, premiumPilot), [])[0].items[0];
  assert.equal(historic.payroll.prima, 169.96);
  const key = enrichJornales(pilot.journals.rows, [], 'Octubre de 2026')[0].payroll.manualPremiumKey;
  const ownHistoric = buildManualSalaryMonths(mergeNorayPilotSalary(null, [], pilot, premiumPilot), [], null,
    { [key]: { amount: 33 } })[0].items[0];
  assert.equal(ownHistoric.payroll.prima, 33);
});

test('la lectura salarial de otro usuario incorpora la prima sin duplicar su jornal manual', () => {
  const pilot = fixture('72668');
  const premium = { schemaVersion: 1, chapa: '72668', rows: [
    { part: '30767', date: '2026-10-24', shift: '02-08', amount: 50.25, status: 'verified' }
  ] };
  const manual = { id: 8, work_date: '2026-10-24', shift: '02-08', specialty: 'CONDUCTOR 1a',
    worker_group: 'II', operation_type: 'SP', premium: 0,
    notes: packManualNotes({ part: '30767', premiumKnown: false }) };
  const merged = mergeNorayPilotSalary(null, [manual], pilot, premium);
  assert.equal(merged.payload.jornales.rows.length, 0);
  const items = buildManualSalaryMonths(merged, [manual])[0].items;
  assert.equal(items.length, 1);
  assert.equal(items[0].payroll.prima, 50.25);
});
