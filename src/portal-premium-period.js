// Never join journals from one month to premiums from another month.
export function selectPremiumRowsForMonth(section, monthLabel) {
  const normalize = (value) => String(value || '').trim().toLocaleLowerCase('es');
  const month = normalize(monthLabel);
  if (!month) return [];
  const periods = [...(Array.isArray(section?.history) ? section.history : []), section];
  const rows = new Map();
  for (const period of periods) {
    if (normalize(period?.monthLabel) !== month) continue;
    for (const row of period.rows || []) {
      const key = String(row.parte || row.values?.[1] || JSON.stringify(row));
      const previous = rows.get(key);
      // An empty current row must not hide an amount already in history.
      if (!previous || String(row.produccion || row.values?.[9] || '').trim()) rows.set(key, row);
    }
  }
  return [...rows.values()];
}
