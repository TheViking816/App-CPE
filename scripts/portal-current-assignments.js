import { canonicalPortalPart, normalizePortalPart } from "../src/portalRowIdentity.js";

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

function normalizeShift(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function key(item) {
  return [canonicalPortalPart(item), item.fecha, normalizeShift(item.jornada)].map((value) => String(value || "").trim()).join("|");
}

export function reconcileAnticipatedAssignmentsWithJournals(journals, assignments) {
  const label = String(journals?.monthLabel || "").toLocaleLowerCase("es");
  const month = MONTHS.findIndex((name) => label.includes(name)) + 1;
  const year = Number(label.match(/\b(20\d{2})\b/)?.[1]);
  if (!month || !year || !Array.isArray(assignments?.rows)) return assignments;

  const rows = assignments.rows.map((assignment) => {
    if (normalizePortalPart(assignment?.parte) !== "CA") return assignment;
    const date = String(assignment.fecha || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!date || Number(date[2]) !== month || Number(date[3]) !== year) return assignment;
    const match = (journals.rows || []).find((journal) => (
      /^\d+$/.test(String(journal?.parte || ""))
      && Number(journal.dia) === Number(date[1])
      && normalizeShift(journal.jornada) === normalizeShift(assignment.jornada)
      && String(journal.especialidad || "").trim().toLocaleUpperCase("es")
        === String(assignment.especialidad || "").trim().toLocaleUpperCase("es")
      && String(journal.operacion || "").trim().toLocaleUpperCase("es")
        === String(assignment.operacion || "").trim().toLocaleUpperCase("es")
    ));
    if (!match) return assignment;
    return {
      ...assignment,
      parte: String(match.parte),
      ...(assignment.detail?.recognized
        ? { detail: { ...assignment.detail, parte: String(match.parte) } }
        : {})
    };
  });
  return { ...assignments, rows };
}

export function assignmentsFromCurrentJournals(journals, assignments, now = new Date()) {
  const label = String(journals?.monthLabel || "").toLocaleLowerCase("es");
  const month = MONTHS.findIndex((name) => label.includes(name));
  const year = Number(label.match(/\b(20\d{2})\b/)?.[1]);
  if (month < 0 || !year) return [];

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const existing = new Set((assignments?.rows || []).map(key));
  const unique = new Map();

  (journals?.rows || []).forEach((row) => {
    const day = Number(row?.dia);
    if (!row?.parte || !Number.isInteger(day) || day < 1 || day > 31) return;
    const date = new Date(year, month, day);
    if (date < today) return;
    const item = {
      ...row,
      fecha: `${String(day).padStart(2, "0")}/${String(month + 1).padStart(2, "0")}/${year}`
    };
    const itemKey = key(item);
    if (!existing.has(itemKey)) unique.set(itemKey, item);
  });

  return [...unique.values()];
}
