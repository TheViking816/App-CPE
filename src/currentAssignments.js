const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

function normalizeShift(value) {
  const hours = String(value || "").match(/(\d{1,2})\s*(?:A|-|–)\s*(\d{1,2})/i);
  return hours ? `${hours[1].padStart(2, "0")}-${hours[2].padStart(2, "0")}` : String(value || "").trim();
}
function parseDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : null;
}

function journalPeriod(journals, now) {
  const label = String(journals?.monthLabel || "").toLocaleLowerCase("es");
  const month = MONTHS.findIndex((name) => label.includes(name));
  const year = Number(label.match(/\b(20\d{2})\b/)?.[1] || now.getFullYear());
  return { month: month >= 0 ? month : now.getMonth(), year };
}

function assignmentKey(item) {
  return [item.fecha, normalizeShift(item.jornada), item.parte].map((value) => String(value || "").trim()).join("|");
}

export function currentAssignmentsFromSnapshot(snapshot, currentTime = Date.now()) {
  const now = new Date(currentTime);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const assignments = Array.isArray(snapshot?.payload?.asignaciones?.rows)
    ? snapshot.payload.asignaciones.rows
    : [];
  const journals = snapshot?.payload?.jornales || {};
  const period = journalPeriod(journals, now);
  const journalAssignments = (Array.isArray(journals.rows) ? journals.rows : [])
    .map((item) => {
      const day = Number(item?.dia);
      if (!Number.isInteger(day) || day < 1 || day > 31) return null;
      return {
        ...item,
        fecha: `${String(day).padStart(2, "0")}/${String(period.month + 1).padStart(2, "0")}/${period.year}`
      };
    })
    .filter(Boolean);

  const unique = new Map();
  // Jornales is a reliable fallback when the legacy "Donde voy" page fails.
  // Assignments is applied last so its full part detail always wins.
  [...journalAssignments, ...assignments].forEach((item) => {
    const date = parseDate(item.fecha);
    if (!date || date < today) return;
    unique.set(assignmentKey(item), item);
  });

  return [...unique.values()].sort((left, right) => (
    parseDate(left.fecha) - parseDate(right.fecha)
    || normalizeShift(left.jornada).localeCompare(normalizeShift(right.jornada))
  ));
}
