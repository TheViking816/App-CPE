import { canonicalPortalPart } from "../src/portalRowIdentity.js";

const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

const pad = (value) => String(value).padStart(2, "0");

function rowKey(row, day = row?.dia) {
  return [Number(day), canonicalPortalPart(row), String(row?.jornada || "").replace(/\s+/g, "").toUpperCase()].join("|");
}

function dedupeRows(rows = []) {
  const unique = new Map();
  rows.forEach((row) => {
    const key = rowKey(row);
    const previous = unique.get(key);
    if (!previous || (previous.upcomingAssignment && !row?.upcomingAssignment)) {
      unique.set(key, row);
    }
  });
  return [...unique.values()];
}

function periodKey(year, month) {
  return Number(year) * 12 + Number(month) - 1;
}

function periodLabel(year, month) {
  const name = MONTHS_ES[month - 1] || "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${year}`;
}

export function mergeAssignmentsIntoPortalJornales(jornales, asignaciones, today = new Date()) {
  const rows = Array.isArray(jornales?.rows) ? jornales.rows : [];
  const assignments = Array.isArray(asignaciones?.rows) ? asignaciones.rows : [];
  const normalizedLabel = String(jornales?.monthLabel || "").trim().toLocaleLowerCase("es");
  const month = MONTHS_ES.findIndex((name) => normalizedLabel.includes(name)) + 1;
  const year = Number(jornales?.year || normalizedLabel.match(/\b(20\d{2})\b/)?.[1]);
  if (!month || !year || !Number.isFinite(today?.getTime?.())) return jornales;

  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const basePeriodKey = periodKey(year, month);
  const periods = new Map();
  (Array.isArray(jornales?.history) ? jornales.history : []).forEach((period) => {
    const periodMonth = Number(period?.month);
    const periodYear = Number(period?.year);
    if (!periodMonth || !periodYear) return;
    periods.set(periodKey(periodYear, periodMonth), {
      ...period,
      year: periodYear,
      month: periodMonth,
      monthLabel: period.monthLabel || periodLabel(periodYear, periodMonth),
      rows: dedupeRows(Array.isArray(period.rows) ? period.rows : [])
    });
  });
  periods.set(basePeriodKey, {
    ...(periods.get(basePeriodKey) || {}),
    year,
    month,
    monthLabel: jornales.monthLabel || periodLabel(year, month),
    rows: dedupeRows(rows)
  });

  let nextAssignmentPeriod = null;

  assignments.forEach((assignment) => {
    const match = String(assignment?.fecha || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return;
    const day = Number(match[1]);
    const assignmentMonth = Number(match[2]);
    const assignmentYear = Number(match[3]);
    const dateKey = `${assignmentYear}-${pad(assignmentMonth)}-${pad(day)}`;
    const assignmentPeriodKey = periodKey(assignmentYear, assignmentMonth);
    if (assignmentPeriodKey < basePeriodKey || dateKey < todayKey) return;

    if (assignmentPeriodKey > basePeriodKey) {
      nextAssignmentPeriod = nextAssignmentPeriod === null
        ? assignmentPeriodKey
        : Math.min(nextAssignmentPeriod, assignmentPeriodKey);
    }

    const period = periods.get(assignmentPeriodKey) || {
      year: assignmentYear,
      month: assignmentMonth,
      monthLabel: periodLabel(assignmentYear, assignmentMonth),
      rows: []
    };
    const keys = new Set(period.rows.map((row) => rowKey(row)));

    const key = rowKey(assignment, day);
    if (keys.has(key)) return;
    period.rows.push({
      ...assignment,
      dia: pad(day),
      jornal: assignment.jornal || "",
      produccion: assignment.produccion || "",
      produccionEstado: assignment.produccionEstado || "unknown",
      upcomingAssignment: true
    });
    periods.set(assignmentPeriodKey, period);
  });

  const activePeriodKey = nextAssignmentPeriod ?? basePeriodKey;
  const activePeriod = periods.get(activePeriodKey) || periods.get(basePeriodKey);
  const history = [...periods.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, period]) => period);
  return {
    ...jornales,
    year: activePeriod.year,
    month: activePeriod.month,
    monthLabel: activePeriod.monthLabel,
    rows: activePeriod.rows,
    history
  };
}
