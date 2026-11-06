import { companyRestMarks } from './companyRestCalendar.js';

export function personalVacationMarks(date, paidDays = []) {
  const paid = paidDays.find((row) => row.work_date === date && row.concept_type === 'VA')
    || paidDays.find((row) => row.work_date === date && ['FM', 'VP'].includes(row.concept_type));
  return paid ? [{ type: paid.concept_type === 'VA' ? 'vacation' : paid.concept_type === 'FM' ? 'training' : 'paid-leave', label: paid.concept_type }] : [];
}

export function personalRestMarks(date, restGroup, overrides = [], paidDays = []) {
  const paid = paidDays.find((row) => row.work_date === date && row.concept_type === 'VA')
    || paidDays.find((row) => row.work_date === date && ['FM', 'VP'].includes(row.concept_type));
  if (paid) return [{ type: paid.concept_type === 'VA' ? 'vacation' : paid.concept_type === 'FM' ? 'training' : 'paid-leave', label: paid.concept_type }];
  const override = overrides.find((row) => row.work_date === date);
  if (override) {
    if (override.day_type === 'WORK') return [];
    return [{ type: override.day_type === 'FS' ? 'chosen-holiday' : 'manual-rest', label: override.day_type === 'FS' ? 'FS' : 'DS' }];
  }
  const [year, month, day] = date.split('-').map(Number);
  return companyRestMarks(year, month, day, restGroup);
}

export function calendarDayMarks(date, vacation, restGroup, overrides = [], paidDays = [], officialDays = {}) {
  const paid = personalVacationMarks(date, paidDays);
  if (paid.length) return paid;
  const official = Object.hasOwn(officialDays, date) ? ({
    DS: { type: 'manual-rest', label: 'DS' },
    FS: { type: 'chosen-holiday', label: 'FS' },
    VA: { type: 'vacation', label: 'VA' },
    FM: { type: 'training', label: 'FM' },
    VP: { type: 'paid-leave', label: 'VP' }
  })[officialDays[date]] : null;
  if (vacation) return ['vacation', 'training', 'paid-leave'].includes(official?.type) ? [official] : [];
  return Object.hasOwn(officialDays, date) ? official ? [official] : [] : personalRestMarks(date, restGroup, overrides, paidDays);
}
