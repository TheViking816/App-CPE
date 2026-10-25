export function closedMonthlyAverage(entries, year, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: 'numeric'
  }).formatToParts(now);
  const currentYear = Number(parts.find((part) => part.type === 'year').value);
  const currentMonth = Number(parts.find((part) => part.type === 'month').value);
  const closed = entries.filter((entry) =>
    (entry.count > 0 || entry.vacationDays > 0 || entry.trainingDays > 0) &&
    (year < currentYear || (year === currentYear && entry.number < currentMonth))
  );
  const months = closed.length;
  return {
    months,
    amount: months ? closed.reduce((sum, entry) => sum + entry.gross, 0) / months : 0
  };
}
