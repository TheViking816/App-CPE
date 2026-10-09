import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarJornales } from '../src/calendarJornales.js';

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
