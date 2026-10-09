// Transcribed from the 2026 company calendar already included in assets.
// Only the remaining months of the current year are shown in the exchange board.
export const COMPANY_REST_2026 = Object.freeze({
  9: {
    a: [12, 13, 15, 24], an: [8, 11, 23], av: [10, 14, 29],
    b: [19, 20, 22, 30], bn: [3, 9, 18], bv: [1, 2, 21],
    c: [5, 6, 26, 27], cn: [7, 17, 25], cv: [4, 16, 28]
  },
  10: {
    a: [9], b: [12], cn: [23],
    v: [3, 4, 17, 18, 31], n: [10, 11, 24, 25]
  },
  11: {
    an: [6], bn: [20], cn: [13],
    v: [1, 14, 15, 28, 29], n: [7, 8, 21, 22]
  },
  12: {
    a: [5, 6, 8, 26, 27], an: [7, 28], av: [4, 9],
    b: [12, 13, 24], bn: [14, 15, 16, 29], bv: [10, 11, 22, 23],
    c: [2, 19, 20, 31], cn: [1, 17, 18], cv: [3, 21, 30],
    holiday: [25]
  }
});

export function parseRestGroup(value) {
  const match = String(value || '').toUpperCase().match(/\b([ABC])\s*[-–]?\s*([VN])\b/);
  return match ? { letter: match[1].toLowerCase(), week: match[2].toLowerCase(), label: `${match[1]}-${match[2]}` } : null;
}

export function companyRestType(year, month, day, groupValue) {
  const calendar = Number(year) === 2026 ? COMPANY_REST_2026[Number(month)] : null;
  const group = typeof groupValue === 'string' ? parseRestGroup(groupValue) : groupValue;
  if (!calendar) return '';
  if (calendar.holiday?.includes(day)) return 'holiday';
  if (!group) return '';
  if (calendar[group.letter]?.includes(day) || calendar[`${group.letter}${group.week}`]?.includes(day)) return `rest-${group.letter}`;
  if (calendar[group.week]?.includes(day)) return `week-${group.week}`;
  return '';
}

export function remainingRestMonths(todayKey) {
  const [year, month] = String(todayKey).split('-').map(Number);
  if (year !== 2026) return [];
  return Array.from({ length: Math.max(0, 13 - month) }, (_, index) => month + index)
    .filter((value) => COMPANY_REST_2026[value]);
}
