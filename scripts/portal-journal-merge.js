const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

const pad = (value) => String(value).padStart(2, "0");

function normalizePart(value) {
  const normalized = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized === "CA" || normalized.includes("CONTRATACIONANTICIPADA")) return "CA";
  return normalized;
}

function rowKey(row, day = row?.dia) {
  return [Number(day), normalizePart(row?.parte), String(row?.jornada || "").replace(/\s+/g, "").toUpperCase()].join("|");
}

export function mergeAssignmentsIntoPortalJornales(jornales, asignaciones, today = new Date()) {
  const rows = Array.isArray(jornales?.rows) ? jornales.rows : [];
  const assignments = Array.isArray(asignaciones?.rows) ? asignaciones.rows : [];
  const normalizedLabel = String(jornales?.monthLabel || "").trim().toLocaleLowerCase("es");
  const month = MONTHS_ES.findIndex((name) => normalizedLabel.includes(name)) + 1;
  const year = Number(jornales?.year || normalizedLabel.match(/\b(20\d{2})\b/)?.[1]);
  if (!month || !year || !Number.isFinite(today?.getTime?.())) return jornales;

  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const keys = new Set(rows.map((row) => rowKey(row)));
  const mergedRows = [...rows];

  assignments.forEach((assignment) => {
    const match = String(assignment?.fecha || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return;
    const day = Number(match[1]);
    const assignmentMonth = Number(match[2]);
    const assignmentYear = Number(match[3]);
    const dateKey = `${assignmentYear}-${pad(assignmentMonth)}-${pad(day)}`;
    if (assignmentMonth !== month || assignmentYear !== year || dateKey < todayKey) return;

    const key = rowKey(assignment, day);
    if (keys.has(key)) return;
    keys.add(key);
    mergedRows.push({
      ...assignment,
      dia: pad(day),
      jornal: assignment.jornal || "",
      produccion: assignment.produccion || "",
      produccionEstado: assignment.produccionEstado || "unknown",
      upcomingAssignment: true
    });
  });

  const history = Array.isArray(jornales?.history)
    ? jornales.history.map((period) => (
        Number(period?.year) === year && Number(period?.month) === month
          ? { ...period, rows: mergedRows }
          : period
      ))
    : jornales?.history;
  return { ...jornales, rows: mergedRows, ...(history ? { history } : {}) };
}
