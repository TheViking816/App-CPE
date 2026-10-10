import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManualSalaryMonths } from '../src/manualSalary.js';
import { RELAY_HOUR_RATES } from '../src/payroll.js';

test('los relevos guardados de dos jornales manuales seguidos se suman al mes', () => {
  const rows = ['08-14', '14-20'].map((shift, index) => ({
    id: index + 1, work_date: '2026-10-10', shift, specialty: 'CONDUCTOR 1a',
    worker_group: 'II', operation_type: 'ESTIBA', premium: 0, notes: ''
  }));
  const [before] = buildManualSalaryMonths(null, rows);
  const relayHours = Object.fromEntries(before.items.map((item) => [item.payroll.relayHourKey, true]));
  const [after] = buildManualSalaryMonths(null, rows, null, {}, relayHours);

  assert.equal(after.items.length, 2);
  assert.equal(after.items.find((item) => item.payroll.shift === '08-14').payroll.relayHour, RELAY_HOUR_RATES.LABORABLE);
  assert.equal(after.items.find((item) => item.payroll.shift === '14-20').payroll.relayHour, RELAY_HOUR_RATES.FESTIVO);
  assert.equal(Number((after.total - before.total).toFixed(2)), RELAY_HOUR_RATES.LABORABLE + RELAY_HOUR_RATES.FESTIVO);
});
