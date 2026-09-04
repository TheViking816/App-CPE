// Render by date, never by the order in which a snapshot was merged.
export function calendarMonths(months = []) {
  return [...months].sort((a, b) => Number(a.year) - Number(b.year) || Number(a.month) - Number(b.month));
}

export function calendarDays(month) {
  const year = Number(month.year);
  const monthNumber = Number(month.month);
  if (!Number.isInteger(year) || year < 1900 || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return [];
  const count = new Date(year, monthNumber, 0).getDate();
  const saved = new Map();
  for (const item of month.days || []) {
    const day = Number(item.day);
    if (!Number.isInteger(day) || day < 1 || day > count) continue;
    const previous = saved.get(day);
    saved.set(day, { ...previous, ...item, day, code: item.code || previous?.code || "" });
  }
  return Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    // Do not invent rest codes for missing cells in a partial calendar.
    return saved.get(day) || { day, code: month.days?.length ? "" : month.codes?.[index] || "" };
  });
}
