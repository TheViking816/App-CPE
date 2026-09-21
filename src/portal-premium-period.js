const MONTHS_ES = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function normalizePeriod(value) {
  const normalized = String(value || "")
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const numeric = normalized.match(/(\d{1,2})\s*\/\s*(\d{4})/);
  if (numeric) return `${numeric[2]}-${String(Number(numeric[1])).padStart(2, "0")}`;
  const named = normalized.match(/([a-z]+)(?:\s+de)?\s+(\d{4})/);
  const month = MONTHS_ES[named?.[1]];
  return month ? `${named[2]}-${String(month).padStart(2, "0")}` : normalized;
}

// Never join journals from one month to premiums from another month.
export function selectPremiumRowsForMonth(section, monthLabel) {
  const month = normalizePeriod(monthLabel);
  if (!month) return [];
  const periods = [...(Array.isArray(section?.history) ? section.history : []), section];
  const rows = new Map();
  for (const period of periods) {
    const periodKey = Number(period?.year) > 0 && Number(period?.month) > 0
      ? `${Number(period.year)}-${String(Number(period.month)).padStart(2, "0")}`
      : normalizePeriod(period?.monthLabel);
    if (periodKey !== month) continue;
    for (const row of period.rows || []) {
      const key = String(row.parte || row.values?.[1] || JSON.stringify(row));
      const previous = rows.get(key);
      // An empty current row must not hide an amount already in history.
      if (!previous || String(row.produccion || row.values?.[9] || '').trim()) rows.set(key, row);
    }
  }
  return [...rows.values()];
}
