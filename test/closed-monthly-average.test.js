import test from 'node:test';
import assert from 'node:assert/strict';
import { closedMonthlyAverage } from '../src/closedMonthlyAverage.js';

const months = [
  { number: 8, count: 2, vacationDays: 0, trainingDays: 0, gross: 600 },
  { number: 9, count: 0, vacationDays: 1, trainingDays: 0, gross: 200 },
  { number: 10, count: 3, vacationDays: 0, trainingDays: 0, gross: 900 },
  { number: 11, count: 0, vacationDays: 0, trainingDays: 0, gross: 0 }
];

test('current month is excluded and a closed month paid only as VA counts', () => {
  assert.deepEqual(closedMonthlyAverage(months, 2026, new Date('2026-10-25T12:00:00Z')),
    { months: 2, amount: 400 });
});

test('Madrid month boundary closes October and past years include every paid month', () => {
  assert.deepEqual(closedMonthlyAverage(months, 2026, new Date('2026-10-31T23:30:00Z')),
    { months: 3, amount: 1700 / 3 });
  assert.deepEqual(closedMonthlyAverage(months, 2025, new Date('2026-10-25T12:00:00Z')),
    { months: 3, amount: 1700 / 3 });
});

test('no closed paid months gives zero average', () => {
  assert.deepEqual(closedMonthlyAverage(months, 2027, new Date('2026-10-25T12:00:00Z')),
    { months: 0, amount: 0 });
});
