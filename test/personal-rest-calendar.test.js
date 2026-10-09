import test from 'node:test';
import assert from 'node:assert/strict';
import { personalRestMarks, personalVacationMarks } from '../src/personalRestCalendar.js';

test('group and weekly rest are identified separately', () => {
  assert.deepEqual(personalRestMarks('2026-10-09', 'A - N'), [{ type: 'rest-a', label: 'A' }]);
  assert.deepEqual(personalRestMarks('2026-10-10', 'A - N'), [{ type: 'week-n', label: 'N' }]);
  assert.deepEqual(personalRestMarks('2026-10-03', 'A - V'), [{ type: 'week-v', label: 'V' }]);
});

test('manual rest, chosen holiday and removed rest override the group calendar', () => {
  const date = '2026-10-09';
  assert.deepEqual(personalRestMarks(date, 'A - N', [{ work_date: date, day_type: 'REST' }]), [{ type: 'manual-rest', label: 'DS' }]);
  assert.deepEqual(personalRestMarks(date, 'A - N', [{ work_date: date, day_type: 'FS' }]), [{ type: 'chosen-holiday', label: 'FS' }]);
  assert.deepEqual(personalRestMarks(date, 'A - N', [{ work_date: date, day_type: 'WORK' }]), []);
});

test('salary VA and FM take precedence over rest edits', () => {
  const date = '2026-10-09';
  const override = [{ work_date: date, day_type: 'REST' }];
  assert.deepEqual(personalRestMarks(date, 'A - N', override, [{ work_date: date, concept_type: 'VA' }]), [{ type: 'vacation', label: 'VA' }]);
  assert.deepEqual(personalRestMarks(date, 'A - N', override, [{ work_date: date, concept_type: 'FM' }]), [{ type: 'training', label: 'FM' }]);
  assert.deepEqual(personalRestMarks(date, 'A - N', override, [{ work_date: date, concept_type: 'FM' }, { work_date: date, concept_type: 'VA' }]), [{ type: 'vacation', label: 'VA' }]);
  assert.deepEqual(personalRestMarks('2026-12-25', 'A - N', [], [{ work_date: '2026-12-25', concept_type: 'VA' }]), [{ type: 'vacation', label: 'VA' }]);
  assert.deepEqual(personalRestMarks('2026-10-10', 'A - N', [], [{ work_date: '2026-10-10', concept_type: 'VA' }]), [{ type: 'vacation', label: 'VA' }]);
});

test('VA appears in the vacation calendar from the shared salary records', () => {
  const rows = [{ work_date: '2026-10-10', concept_type: 'VA' }, { work_date: '2026-10-11', concept_type: 'FM' }];
  assert.deepEqual(personalVacationMarks('2026-10-10', rows), [{ type: 'vacation', label: 'VA' }]);
  assert.deepEqual(personalVacationMarks('2026-10-11', rows), []);
});
