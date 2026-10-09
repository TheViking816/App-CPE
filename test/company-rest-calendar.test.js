import test from 'node:test';
import assert from 'node:assert/strict';
import { companyRestType, parseRestGroup, remainingRestMonths } from '../src/companyRestCalendar.js';

test('recognizes all six stored rest groups', () => {
  for (const letter of ['A', 'B', 'C']) {
    for (const week of ['N', 'V']) {
      assert.deepEqual(parseRestGroup(`${letter} - ${week}`), {
        letter: letter.toLowerCase(), week: week.toLowerCase(), label: `${letter}-${week}`
      });
    }
  }
  assert.equal(parseRestGroup(''), null);
});

test('matches group rest and weekly colors from the 2026 company calendar', () => {
  assert.equal(companyRestType(2026, 10, 9, 'A - N'), 'rest-a');
  assert.equal(companyRestType(2026, 10, 10, 'A - N'), 'week-n');
  assert.equal(companyRestType(2026, 10, 3, 'A - V'), 'week-v');
  assert.equal(companyRestType(2026, 10, 12, 'B - N'), 'rest-b');
  assert.equal(companyRestType(2026, 10, 23, 'C - V'), '');
  assert.equal(companyRestType(2026, 10, 23, 'C - N'), 'rest-c');
  assert.equal(companyRestType(2026, 12, 25, 'C - N'), 'holiday');
  assert.equal(companyRestType(2027, 10, 9, 'A - N'), '');
});

test('shows only the remaining available months through December', () => {
  assert.deepEqual(remainingRestMonths('2026-10-09'), [10, 11, 12]);
  assert.deepEqual(remainingRestMonths('2026-12-01'), [12]);
  assert.deepEqual(remainingRestMonths('2027-01-01'), []);
});
