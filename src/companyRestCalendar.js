// Transcribed from the 2026 company calendar already included in assets.
// Every month can be browsed; the exchange board opens on the current month.
export const COMPANY_REST_2026 = Object.freeze({
  1: {
    a: [22], bv: [9], c: [6],
    v: [10, 11, 24, 25], n: [3, 4, 17, 18, 31], holiday: [1]
  },
  2: {
    an: [27], av: [20], bn: [16], bv: [23], cn: [13], cv: [6],
    v: [7, 8, 21, 22], n: [1, 14, 15, 28]
  },
  3: {
    av: [23], bv: [2], cv: [9],
    v: [7, 8, 21, 22], n: [1, 14, 15, 28, 29], holiday: [19]
  },
  4: {
    a: [13], bv: [3], c: [6],
    v: [4, 5, 18, 19], n: [11, 12, 25, 26]
  },
  5: {
    an: [25], bn: [18], cn: [11],
    v: [2, 3, 16, 17, 30, 31], n: [9, 10, 23, 24], holiday: [1]
  },
  6: {
    an: [19], av: [26], bn: [5], bv: [12], c: [24],
    v: [13, 14, 27, 28], n: [6, 7, 20, 21]
  },
  7: {
    a: [11, 12], an: [2, 13, 14, 23, 31], av: [21, 22, 28, 29],
    b: [1, 16, 18, 19, 30], bn: [8, 17], bv: [9, 20],
    c: [4, 5, 25, 26], cn: [3, 15, 27], cv: [7, 10, 24]
  },
  8: {
    a: [1, 2, 22, 23], an: [12, 13, 24], av: [3, 4, 21],
    b: [8, 9, 29, 30], bn: [10, 11, 28], bv: [7, 20, 31],
    c: [15, 16, 26], cn: [14, 18, 19, 25], cv: [5, 6, 17, 27]
  },
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
  return companyRestMarks(year, month, day, groupValue)[0]?.type || '';
}

export function companyRestMarks(year, month, day, groupValue) {
  const calendar = Number(year) === 2026 ? COMPANY_REST_2026[Number(month)] : null;
  const group = typeof groupValue === 'string' ? parseRestGroup(groupValue) : groupValue;
  if (!calendar) return [];
  if (calendar.holiday?.includes(day)) return [{ type: 'holiday', label: 'FI' }];
  if (!group) return [];
  const marks = [];
  if (calendar[group.letter]?.includes(day) || calendar[`${group.letter}${group.week}`]?.includes(day))
    marks.push({ type: `rest-${group.letter}`, label: 'DS' });
  if (calendar[group.week]?.includes(day))
    marks.push({ type: `week-${group.week}`, label: 'DS' });
  return marks;
}

export function availableRestMonths(year) {
  if (year !== 2026) return [];
  return Array.from({ length: 12 }, (_, index) => index + 1)
    .filter((month) => COMPANY_REST_2026[month]);
}
