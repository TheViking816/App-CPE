import { companyRestMarks } from './companyRestCalendar.js';

export function personalVacationMarks(date, paidDays = []) {
  return paidDays.some((row) => row.work_date === date && row.concept_type === 'VA')
    ? [{ type: 'vacation', label: 'VA' }] : [];
}

export function personalRestMarks(date, restGroup, overrides = [], paidDays = []) {
  const paid = paidDays.find((row) => row.work_date === date && row.concept_type === 'VA')
    || paidDays.find((row) => row.work_date === date && row.concept_type === 'FM');
  if (paid) return [{ type: paid.concept_type === 'FM' ? 'training' : 'vacation', label: paid.concept_type }];
  const override = overrides.find((row) => row.work_date === date);
  if (override) {
    if (override.day_type === 'WORK') return [];
    return [{ type: override.day_type === 'FS' ? 'chosen-holiday' : 'manual-rest', label: override.day_type === 'FS' ? 'FS' : 'DS' }];
  }
  const [year, month, day] = date.split('-').map(Number);
  return companyRestMarks(year, month, day, restGroup);
}
