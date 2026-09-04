// A successfully read empty month is data, not a disconnected portal.
export function hasSalaryData(journalSection, history = [], entries = []) {
  return entries.length > 0
    || Boolean(journalSection?.recognized && String(journalSection.monthLabel || "").trim()
      && Array.isArray(journalSection.rows))
    || history.some(period => String(period?.monthLabel || "").trim()
      && Array.isArray(period.rows) && period.rows.length > 0);
}
