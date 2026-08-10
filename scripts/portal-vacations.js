const DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function parseDate(value) {
  const match = String(value || "").match(DATE_PATTERN);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function inclusiveDays(start, end) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate || endDate < startDate) return 0;
  return Math.floor((endDate - startDate) / 86400000) + 1;
}

export function parseVacacionesFromRows(rows = [], pageText = "") {
  const heading = String(pageText || "").match(
    /Mes\s+Inicial\s+de\s+Vacaciones\s+(\d{4})\s*:\s*([^\n|]+)/i
  );
  const recognized = Boolean(heading || /SOLICITUD(?:ES)?\s+VACACIONES|\bVACACIONES\b/i.test(pageText));
  const periods = rows
    .filter((row) => DATE_PATTERN.test(String(row[0] || "")) && DATE_PATTERN.test(String(row[1] || "")))
    .map((row) => {
      const calculatedDays = inclusiveDays(row[0], row[1]);
      const reportedDays = Number.parseInt(String(row[2] || ""), 10);
      const accumulated = Number.parseInt(String(row[3] || ""), 10);
      return {
        inicio: row[0],
        fin: row[1],
        dias: Number.isFinite(reportedDays) && reportedDays > 0 ? reportedDays : calculatedDays,
        acumulado: Number.isFinite(accumulated) && accumulated > 0 ? accumulated : null
      };
    });

  return {
    recognized,
    year: Number(heading?.[1]) || null,
    initialMonth: String(heading?.[2] || "").trim(),
    totalDays: periods.reduce((total, period) => total + period.dias, 0),
    rows: periods
  };
}
