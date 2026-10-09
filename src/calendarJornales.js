import { buildManualSalaryMonths } from './manualSalary.js';

const MAIN_SHIFT_ORDER = ['02-08', '08-14', '14-20', '20-02'];
const shiftRank = (shift) => {
  const mainIndex = MAIN_SHIFT_ORDER.indexOf(shift);
  if (mainIndex >= 0) return mainIndex * 100;
  const start = Number(String(shift).slice(0, 2));
  return Number.isFinite(start) ? start * 100 + 50 : 9999;
};

export function calendarJornales(snapshot, manualRows = []) {
  const byDate = {};
  for (const month of buildManualSalaryMonths(snapshot, manualRows)) {
    for (const item of month.items) {
      const date = item.payroll?.date;
      const shift = item.payroll?.shift;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}-\d{2}$/.test(shift || '')) continue;
      (byDate[date] ||= []).push(shift);
    }
  }
  for (const shifts of Object.values(byDate)) shifts.sort((a, b) => shiftRank(a) - shiftRank(b) || a.localeCompare(b));
  return byDate;
}
