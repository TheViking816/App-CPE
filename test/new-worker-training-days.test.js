import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManualSalaryMonths, salaryPeriod } from '../src/manualSalary.js';
import { personalRestMarks } from '../src/personalRestCalendar.js';
import { TRAINING_DAY_RATE } from '../src/payroll.js';

const days = [19, 20, 21, 22].map(day => ({
  id: `training-${day}`, work_date: `2026-10-${day}`, concept_type: 'FM'
}));

test('los cuatro FM de las nuevas chapas aparecen en Sueldómetro y Descansos', () => {
  const months = buildManualSalaryMonths(null, [], null, {}, {}, {}, days);
  assert.equal(months.length, 1);
  const period = salaryPeriod(months[0].items, 'second');
  assert.equal(period.items.length, 4);
  assert.equal(period.total, Number((4 * TRAINING_DAY_RATE).toFixed(2)));
  for (const day of days) {
    assert.equal(period.items.filter(item => item.payroll.date === day.work_date && item.isTraining).length, 1);
    for (const group of ['A - N', 'A - V', 'B - N', 'B - V', 'C - N', 'C - V']) {
      assert.deepEqual(personalRestMarks(day.work_date, group, [], days), [{ type: 'training', label: 'FM' }]);
    }
  }
});
