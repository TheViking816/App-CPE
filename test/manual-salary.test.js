import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManualSalaryMonths, companyImage, manualPaidDayEntry, salaryPeriod } from '../src/manualSalary.js';
import { optionsForGroup } from '../src/manualSpecialties.js';
import { enrichJornales } from '../src/payroll.js';
import { packManualNotes, unpackManualNotes } from '../src/manualMetadata.js';

test('retains saved history and adds new manual jornales without altering it', () => {
  const saved = { dia: '05', jornada: '08-14', especialidad: 'Conductor 1A', operacion: 'ESTIBA', parte: '123' };
  const snapshot = { payload: { jornales: { monthLabel: 'Septiembre de 2026', rows: [saved], history: [
    { year: 2026, month: 8, monthLabel: 'Agosto de 2026', rows: [{ ...saved, dia: '02' }] },
    { year: 2026, month: 9, monthLabel: 'Septiembre de 2026', rows: [saved] }
  ] }, primas: { rows: [], history: [] } } };
  const manual = [{ id: 'new-1', work_date: '2026-10-08', shift: '08-14', specialty: 'Conductor 1A', worker_group: 'II', operation_type: 'ESTIBA', premium: 50, notes: '' }];
  const months = buildManualSalaryMonths(snapshot, manual);
  assert.deepEqual(months.map(({ key }) => key), ['2026-10', '2026-09', '2026-08']);
  assert.equal(months[0].items[0].source, 'manual');
  assert.equal(months[0].items[0].operacion, 'CONT. C/SPREADER AUT');
  assert.equal(months[0].items[0].payroll.prima, 50);
  assert.equal(months[0].total, months[0].items[0].payroll.base + months[0].items[0].payroll.complement + 50);
  assert.equal(months[1].items[0].source, 'historico');
  assert.equal(snapshot.payload.jornales.history[1].rows[0], saved);
  const key = months[1].items[0].payroll.manualPremiumKey;
  const overridden = buildManualSalaryMonths(snapshot, manual, null, { [key]: { amount: 32 } });
  assert.equal(overridden[1].items[0].payroll.prima, 32);
  assert.equal(overridden[1].items[0].payroll.primaSource, 'manual');
  assert.equal(salaryPeriod(months[0].items, 'first').items.length, 1);
  assert.equal(salaryPeriod(months[0].items, 'second').items.length, 0);
  assert.equal(salaryPeriod(months[1].items, 'month').items.length, 1);
  assert.equal(companyImage('CSP IBERIAN VALENCIA TERMINAL'), '/assets/empresas/csp.jpeg');
  assert.equal(companyImage('TCV'), '/assets/empresas/tcv.svg');
});

test('includes saved paid vacation days in monthly and annual salary data', () => {
  const snapshot = { payload: { descansos: { months: [{ year: 2026, month: 10, days: [{ day: 3, code: 'VA' }, { day: 4, code: 'VA' }] }] } } };
  const months = buildManualSalaryMonths(snapshot);
  assert.equal(months[0].key, '2026-10');
  assert.equal(months[0].items.filter((item) => item.isVacation).length, 2);
  assert.equal(salaryPeriod(months[0].items, 'first').items.length, 2);
  assert.equal(salaryPeriod(months[0].items, 'second').items.length, 0);
  assert.equal(months[0].total, months[0].items.reduce((sum, item) => sum + item.payroll.total, 0));
});

test('includes saved FM days once when both calendar sources contain them', () => {
  const month = { year: 2026, month: 10, days: [{ day: 8, code: 'FM' }] };
  const snapshot = { payload: { descansos: { months: [month] }, disponibilidad: { trainingHistory: [month] } } };
  const months = buildManualSalaryMonths(snapshot);
  assert.equal(months[0].items.filter((item) => item.isTraining).length, 1);
  assert.equal(months[0].items.filter((item) => item.isVacation).length, 0);
});

test('manual VA and FM use their own rates and count in their fortnight without duplicates', () => {
  const snapshot = { payload: { descansos: { months: [{ year: 2026, month: 10, days: [{ day: 3, code: 'VA' }] }] } } };
  const paid = [
    { id: 'va-1', work_date: '2026-10-03', concept_type: 'VA' },
    { id: 'fm-1', work_date: '2026-10-20', concept_type: 'FM' }
  ];
  const months = buildManualSalaryMonths(snapshot, [], null, {}, {}, {}, paid);
  const first = salaryPeriod(months[0].items, 'first');
  const second = salaryPeriod(months[0].items, 'second');
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].id, 'va-1');
  assert.equal(first.total, manualPaidDayEntry(paid[0]).payroll.total);
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].isTraining, true);
  assert.equal(second.total, manualPaidDayEntry(paid[1]).payroll.total);
  assert.equal(months[0].total, first.total + second.total);
});

test('filters posts by group and uses reception rates for OC', () => {
  assert.deepEqual(optionsForGroup('III'), ['CLASIFICADOR']);
  assert.deepEqual(optionsForGroup('IV'), ['CAPATAZ', 'SOBORDISTA']);
  assert.deepEqual(optionsForGroup('I'), ['TRINCADOR', 'ESPECIALISTA']);
  assert.ok(optionsForGroup('II').includes('CONDUCTOR 1a'));
  const row = { dia: 8, jornada: '08-14', especialidad: 'CONDUCTOR 1a', payrollGroup: 'II', parte: 'MANUAL-TEST' };
  const sp = enrichJornales([{ ...row, operacion: 'ESTIBA' }], [], '10/2026')[0].payroll;
  const oc = enrichJornales([{ ...row, operacion: 'RECEPCION Y ENTREGA' }], [], '10/2026')[0].payroll;
  assert.equal(sp.operationType, 'ESTIBA');
  assert.equal(oc.operationType, 'RECEPCION_ENTREGA');
  assert.notEqual(sp.base, oc.base);
  assert.equal(sp.group, 'II');
  const manualRows = [
    { id: 'sp', work_date: '2026-10-08', shift: '08-14', specialty: 'CONDUCTOR 1a', worker_group: 'II', operation_type: 'ESTIBA', premium: 0 },
    { id: 'oc', work_date: '2026-10-08', shift: '08-14', specialty: 'CONDUCTOR 1a', worker_group: 'II', operation_type: 'RECEPCION_ENTREGA', premium: 0 },
    { id: 'second-driver', work_date: '2026-10-08', shift: '08-14', specialty: 'CONDUCTOR 2a', worker_group: 'II', operation_type: 'ESTIBA', premium: 0 }
  ];
  const items = buildManualSalaryMonths(null, manualRows)[0].items;
  assert.equal(items.find((item) => item.id === 'sp').operacion, 'CONT. C/SPREADER AUT');
  assert.equal(items.find((item) => item.id === 'oc').operacion, 'RECEPCION / ENTREGA');
  assert.equal(items.find((item) => item.id === 'second-driver').operacion, 'RO-RO (Vehículos)');
  assert.equal(items.find((item) => item.id === 'sp').payroll.operationType, 'ESTIBA');
  assert.equal(items.find((item) => item.id === 'oc').payroll.operationType, 'RECEPCION_ENTREGA');
  assert.notEqual(items.find((item) => item.id === 'sp').payroll.base, items.find((item) => item.id === 'oc').payroll.base);
});

test('stores the part number, company and vessel without losing old notes', () => {
  const input = { company: 'CSP', vessel: 'MAERSK VALENCIA', part: '29050', notes: 'Turno de prueba' };
  assert.deepEqual(unpackManualNotes(packManualNotes(input)), input);
  assert.deepEqual(unpackManualNotes('Nota antigua'), { company: '', vessel: '', part: '', notes: 'Nota antigua' });
  assert.deepEqual(unpackManualNotes(packManualNotes({ company: 'CSP', vessel: 'MAERSK VALENCIA', notes: 'Nota anterior' })),
    { company: 'CSP', vessel: 'MAERSK VALENCIA', part: '', notes: 'Nota anterior' });
  assert.throws(() => packManualNotes({ part: '29A50' }), /número de parte válido/);
  const months = buildManualSalaryMonths(null, [{ id: 'manual-1', work_date: '2026-10-08', shift: '08-14',
    specialty: 'CONDUCTOR 1a', worker_group: 'II', operation_type: 'ESTIBA', premium: 0,
    notes: packManualNotes(input) }]);
  assert.equal(months[0].items[0].empresa, 'CSP');
  assert.equal(months[0].items[0].buque, 'MAERSK VALENCIA');
  assert.equal(months[0].items[0].parte, '29050');
  assert.equal(months[0].items[0].manualPart, '29050');
  assert.equal(months[0].items[0].notes, 'Turno de prueba');
});
