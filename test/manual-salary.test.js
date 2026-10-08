import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManualSalaryMonths, companyImage, salaryPeriod } from '../src/manualSalary.js';
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
  assert.equal(companyImage('TCV'), '');
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
});

test('stores company and vessel in existing manual record without losing old notes', () => {
  const input = { company: 'CSP', vessel: 'MAERSK VALENCIA', notes: 'Turno de prueba' };
  assert.deepEqual(unpackManualNotes(packManualNotes(input)), input);
  assert.deepEqual(unpackManualNotes('Nota antigua'), { company: '', vessel: '', notes: 'Nota antigua' });
  const months = buildManualSalaryMonths(null, [{ id: 'manual-1', work_date: '2026-10-08', shift: '08-14',
    specialty: 'CONDUCTOR 1a', worker_group: 'II', operation_type: 'ESTIBA', premium: 0,
    notes: packManualNotes(input) }]);
  assert.equal(months[0].items[0].empresa, 'CSP');
  assert.equal(months[0].items[0].buque, 'MAERSK VALENCIA');
  assert.equal(months[0].items[0].notes, 'Turno de prueba');
});
