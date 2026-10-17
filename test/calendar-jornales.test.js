import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarJornales } from '../src/calendarJornales.js';
import { buildManualSalaryMonths } from '../src/manualSalary.js';

test('shows saved and manual jornales in shift order for each date', () => {
  const snapshot = { payload: { jornales: { history: [{
    year: 2026, month: 10, monthLabel: 'Octubre de 2026',
    rows: ['20-02', '08-14', '02-08', '14-20'].map((jornada) => ({
      dia: '10', jornada, especialidad: 'CONDUCTOR 1a', payrollGroup: 'II', operacion: 'ESTIBA'
    }))
  }] } } };
  const manual = [{ id: 'manual-1', work_date: '2026-10-11', shift: '08-14',
    specialty: 'CONDUCTOR 1a', worker_group: 'II', operation_type: 'ESTIBA', premium: 0 }];
  assert.deepEqual(calendarJornales(snapshot, manual), {
    '2026-10-10': ['02-08', '08-14', '14-20', '20-02'],
    '2026-10-11': ['08-14']
  });
});

test('marca +1 solo en el turno cuya hora de relevo está activada', () => {
  const manual = ['08-14', '14-20'].map((shift, index) => ({
    id: index + 1, work_date: '2026-10-10', shift, specialty: 'CONDUCTOR 1a',
    worker_group: 'II', operation_type: 'ESTIBA', premium: 0, notes: ''
  }));
  const month = buildManualSalaryMonths(null, manual)[0];
  const second = month.items.find((item) => item.payroll.shift === '14-20');
  assert.deepEqual(calendarJornales(null, manual, { [second.payroll.relayHourKey]: true }), {
    '2026-10-10': ['08-14', '14-20+1']
  });
  assert.deepEqual(calendarJornales(null, manual), { '2026-10-10': ['08-14', '14-20'] });
});
