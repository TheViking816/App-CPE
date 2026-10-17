import { buildManualSalaryMonths } from './manualSalary.js';

const MAIN_SHIFT_ORDER = ['02-08', '08-14', '14-20', '20-02'];
const shiftRank = (shift) => {
  const mainIndex = MAIN_SHIFT_ORDER.indexOf(shift);
  if (mainIndex >= 0) return mainIndex * 100;
  const start = Number(String(shift).slice(0, 2));
  return Number.isFinite(start) ? start * 100 + 50 : 9999;
};

export function calendarJornales(snapshot, manualRows = [], relayHours = {}) {
  const byDate = {};
  for (const month of buildManualSalaryMonths(snapshot, manualRows, null, {}, relayHours)) {
    for (const item of month.items) {
      const date = item.payroll?.date;
      const shift = item.payroll?.shift;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}-\d{2}$/.test(shift || '')) continue;
      (byDate[date] ||= []).push({ shift, relayHourEnabled: item.payroll.relayHourEnabled });
    }
  }
  for (const [date, shifts] of Object.entries(byDate)) {
    byDate[date] = shifts.sort((a, b) => shiftRank(a.shift) - shiftRank(b.shift) || a.shift.localeCompare(b.shift))
      .map(({ shift, relayHourEnabled }) => `${shift}${relayHourEnabled ? '+1' : ''}`);
  }
  return byDate;
}
