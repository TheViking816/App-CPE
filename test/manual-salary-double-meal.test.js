import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManualSalaryMonths } from '../src/manualSalary.js';
import { CONTINUOUS_DOUBLE_MEAL_RATE } from '../src/payroll.js';

const manual = (id, day, shift) => ({ id, work_date: `2026-10-${day}`, shift,
  specialty: 'CONDUCTOR 1a', worker_group: 'II', operation_type: 'ESTIBA', premium: 0, notes: '' });

test('añade la manutención de comida al segundo jornal manual continuo', () => {
  const [month] = buildManualSalaryMonths(null, [manual(1, '10', '08-14'), manual(2, '10', '14-20')]);
  const first = month.items.find((item) => item.payroll.shift === '08-14');
  const second = month.items.find((item) => item.payroll.shift === '14-20');
  assert.equal(first.payroll.continuousDoubleMeal, 0);
  assert.equal(second.payroll.continuousDoubleMeal, CONTINUOUS_DOUBLE_MEAL_RATE);
  assert.equal(second.payroll.continuousDoubleMealHours, '14-15');
  assert.equal(month.total, Number((first.payroll.total + second.payroll.total).toFixed(2)));
});

test('reconoce una pareja histórica y manual sin duplicar la manutención', () => {
  const snapshot = { payload: { jornales: { monthLabel: 'Octubre de 2026', rows: [{
    dia: '10', jornada: '08-14', especialidad: 'CONDUCTOR 1a', operacion: 'ESTIBA', parte: '100'
  }] } } };
  const [month] = buildManualSalaryMonths(snapshot, [manual(2, '10', '14-20')]);
  assert.equal(month.items.filter((item) => item.payroll.continuousDoubleMeal > 0).length, 1);
  assert.equal(month.items.find((item) => item.source === 'manual').payroll.continuousDoubleMeal, CONTINUOUS_DOUBLE_MEAL_RATE);
});

test('añade cena al segundo jornal nocturno y no suma turnos de días distintos', () => {
  const [month] = buildManualSalaryMonths(null, [manual(1, '10', '14-20'), manual(2, '10', '20-02'), manual(3, '11', '08-14')]);
  assert.equal(month.items.find((item) => item.id === 2).payroll.continuousDoubleMealHours, '20-21');
  assert.equal(month.items.find((item) => item.id === 3).payroll.continuousDoubleMeal, 0);
});
