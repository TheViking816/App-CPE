import test from 'node:test';
import assert from 'node:assert/strict';
import { availableRestMonths, companyRestType, parseRestGroup } from '../src/companyRestCalendar.js';

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

test('matches group rest and weekly dates from the 2026 company calendar', () => {
  assert.equal(companyRestType(2026, 10, 9, 'A - N'), 'rest-a');
  assert.equal(companyRestType(2026, 10, 10, 'A - N'), 'week-n');
  assert.equal(companyRestType(2026, 10, 3, 'A - V'), 'week-v');
  assert.equal(companyRestType(2026, 10, 12, 'B - N'), 'rest-b');
  assert.equal(companyRestType(2026, 10, 23, 'C - V'), '');
  assert.equal(companyRestType(2026, 10, 23, 'C - N'), 'rest-c');
  assert.equal(companyRestType(2026, 12, 25, 'C - N'), 'holiday');
  assert.equal(companyRestType(2028, 10, 9, 'A - N'), '');
});

test('makes every month of the company year available', () => {
  assert.deepEqual(availableRestMonths(2026), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(availableRestMonths(2027), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(companyRestType(2026, 1, 1, 'A - N'), 'holiday');
  assert.equal(companyRestType(2026, 4, 13, 'A - V'), 'rest-a');
  assert.equal(companyRestType(2026, 7, 10, 'C - V'), 'rest-c');
  assert.equal(companyRestType(2026, 8, 26, 'C - N'), 'rest-c');
});

test('shows the published 2027 dates for each group, including the year boundary', () => {
  const groupDates = [
    ['A-N', 2, 2, 'rest-a'], ['A-V', 2, 3, 'rest-a'],
    ['B-N', 2, 16, 'rest-b'], ['B-V', 2, 17, 'rest-b'],
    ['C-N', 2, 10, 'rest-c'], ['C-V', 2, 9, 'rest-c'],
    ['A-V', 1, 2, 'week-v'], ['A-N', 1, 9, 'week-n'],
    ['A-V', 5, 1, 'holiday'], ['C-N', 12, 25, 'holiday'],
    ['B-N', 8, 1, 'rest-b'], ['B-V', 8, 1, 'rest-b'],
    ['C-V', 12, 23, ''], ['C-N', 12, 23, 'rest-c']
  ];
  for (const [group, month, day, type] of groupDates) {
    assert.equal(companyRestType(2027, month, day, group), type, `${group} ${month}/${day}`);
  }
});
