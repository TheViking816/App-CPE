import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManualSalaryMonths, companyImage, manualPaidDayEntry, salaryPeriod, sharedPremiumRequest } from '../src/manualSalary.js';

test('a shared premium fills only a jornal without its own saved premium', () => {
  const template = { work_date: '2026-10-09', shift: '14-20', specialty: 'CONDUCTOR 1a',
    worker_group: 'II', operation_type: 'ESTIBA',
    notes: packManualNotes({ part: '29211', vessel: 'MSC Lagos', company: 'MSC', premiumKnown: false }) };
  const pending = { ...template, id: 'pending', premium: 0 };
  const saved = { ...template, id: 'saved', premium: 83,
    notes: packManualNotes({ part: '29211', vessel: 'MSC Lagos', company: 'MSC', premiumKnown: true }) };
  const shared = { 'manual:pending': 176.64, 'manual:saved': 176.64 };
  const items = buildManualSalaryMonths(null, [pending, saved], null, {}, {}, {}, [], shared)[0].items;
  assert.equal(items.find((item) => item.id === 'pending').payroll.prima, 176.64);
  assert.equal(items.find((item) => item.id === 'saved').payroll.prima, 83);
  assert.equal(sharedPremiumRequest(items[0]).parte, '29211');
});

test('a premium already saved in the historical extract is never replaced', () => {
  const snapshot = { payload: { jornales: { monthLabel: 'Octubre de 2026', rows: [
    { dia: '09', jornada: '14-20', especialidad: 'CONDUCTOR 1a', parte: '29211', buque: 'MSC Lagos' }
  ] }, primas: { monthLabel: 'Octubre de 2026', rows: [
    { parte: '29211', produccion: '83,00' }
  ] } } };
  const original = buildManualSalaryMonths(snapshot)[0].items[0];
  const key = sharedPremiumRequest(original).key;
  const after = buildManualSalaryMonths(snapshot, [], null, {}, {}, {}, [], { [key]: 176.64 })[0].items[0];
  assert.equal(after.payroll.prima, 83);
});
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
  assert.equal(companyImage('TCV'), '/assets/empresas/apm.jpeg');
});

test('shows a contracted November jornal before the salary history reaches November', () => {
  const assignment = { fecha: '2026-11-02', jornada: '02-08', parte: '31755', tipo: 'TUR',
    especialidad: 'CONDUCTOR 1a', empresa: 'CSP IBERIAN VALENCIA TERMINAL',
    buque: 'CMA CGM MARCO POLO', operacion: 'CONT. C/SPREADER AUT' };
  const snapshot = { payload: { jornales: { history: [{ year: 2026, month: 10,
    monthLabel: 'Octubre de 2026', rows: [] }] }, upcomingAssignments: [assignment] } };
  const months = buildManualSalaryMonths(snapshot);
  assert.deepEqual(months.map((entry) => entry.key), ['2026-11', '2026-10']);
  assert.equal(months[0].items.length, 1);
  assert.equal(months[0].items[0].parte, '31755');
  assert.equal(months[0].items[0].payroll.date, '2026-11-02');
  assert.ok(months[0].items[0].payroll.total > 0);
});

test('does not count a contracted jornal twice when it is already saved', () => {
  const assignment = { fecha: '2026-11-02', jornada: '02-08', parte: '31755',
    especialidad: 'CONDUCTOR 1a', empresa: 'CSP', operacion: 'ESTIBA' };
  const row = { dia: '02', jornada: '02-08', parte: '31755', especialidad: 'CONDUCTOR 1a' };
  const snapshot = { payload: { jornales: { history: [{ year: 2026, month: 11,
    monthLabel: 'Noviembre de 2026', rows: [row] }] }, upcomingAssignments: [assignment] } };
  assert.equal(buildManualSalaryMonths(snapshot)[0].items.length, 1);
  assert.equal(snapshot.payload.jornales.history[0].rows.length, 1);
  const manual = { id: 'manual-1', work_date: '2026-11-02', shift: '02-08',
    specialty: 'CONDUCTOR 1a', worker_group: 'II', operation_type: 'ESTIBA', premium: 0 };
  assert.equal(buildManualSalaryMonths({ payload: { upcomingAssignments: [assignment] } }, [manual])[0].items.length, 1);
});

test('shows imported vacation days from the shared paid-day table', () => {
  const snapshot = { payload: { descansos: { months: [{ year: 2026, month: 10, days: [{ day: 3, code: 'VA' }, { day: 4, code: 'VA' }] }] } } };
  const paid = [3, 4].map((day) => ({ id: `va-${day}`, work_date: `2026-10-0${day}`, concept_type: 'VA' }));
  const months = buildManualSalaryMonths(snapshot, [], null, {}, {}, {}, paid);
  assert.equal(months[0].key, '2026-10');
  assert.equal(months[0].items.filter((item) => item.isVacation).length, 2);
  assert.equal(salaryPeriod(months[0].items, 'first').items.length, 2);
  assert.equal(salaryPeriod(months[0].items, 'second').items.length, 0);
  assert.equal(months[0].total, months[0].items.reduce((sum, item) => sum + item.payroll.total, 0));
});

test('uses the shared paid-day table for FM even when the old snapshot contains it', () => {
  const month = { year: 2026, month: 10, days: [{ day: 8, code: 'FM' }] };
  const snapshot = { payload: { descansos: { months: [month] }, disponibilidad: { trainingHistory: [month] } } };
  const months = buildManualSalaryMonths(snapshot, [], null, {}, {}, {}, [{ id: 'fm-8', work_date: '2026-10-08', concept_type: 'FM' }]);
  assert.equal(months[0].items.filter((item) => item.isTraining).length, 1);
  assert.equal(months[0].items.filter((item) => item.isVacation).length, 0);
});

test('five future FM saved in the calendar form a visible salary month without jornales', () => {
  const paid = [23, 24, 25, 26, 27].map((day) => ({
    id: `fm-${day}`, work_date: `2026-11-${day}`, concept_type: 'FM'
  }));
  const months = buildManualSalaryMonths(null, [], null, {}, {}, {}, paid);
  assert.equal(months[0].key, '2026-11');
  const period = salaryPeriod(months[0].items, 'month');
  assert.equal(period.items.length, 5);
  assert.ok(period.items.every((item) => item.isTraining));
  assert.equal(period.total, Number((5 * manualPaidDayEntry(paid[0]).payroll.total).toFixed(2)));
});

test('deleted VA and FM stay absent even when still present in the old portal snapshot', () => {
  const snapshot = { payload: { vacaciones: { rows: [{ inicio: '03/10/2026', fin: '03/10/2026' }] },
    descansos: { months: [{ year: 2026, month: 10, days: [{ day: 8, code: 'FM' }] }] } } };
  assert.equal(buildManualSalaryMonths(snapshot).length, 0);
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
