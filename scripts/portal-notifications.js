import { createHash } from "node:crypto";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function periodRows(section) {
  const periods = [];
  if (Array.isArray(section?.history)) {
    section.history.forEach((period) => {
      if (Array.isArray(period?.rows)) periods.push({ label: clean(period.monthLabel || `${period.month || ""}/${period.year || ""}`), rows: period.rows });
    });
  }
  if (Array.isArray(section?.rows)) periods.push({ label: clean(section.monthLabel || `${section.month || ""}/${section.year || ""}`), rows: section.rows });

  const unique = new Map();
  periods.forEach((period) => period.rows.forEach((row) => {
    const fingerprint = [period.label, row?.dia, row?.parte, row?.jornada, row?.especialidad, row?.tipo, row?.jornal].map(clean).join("|");
    unique.set(fingerprint, { period: period.label, row });
  }));
  return [...unique.values()];
}

function journalKey(item) {
  const row = item.row || {};
  const period = clean(item.period).toLocaleLowerCase("es-ES");
  const day = clean(row.dia).padStart(2, "0");
  const shift = clean(row.jornada).replace(/[^0-9]/g, "");
  return [period, day, shift].join("|");
}

function premiumKey(item) {
  const row = item.row || {};
  return [item.period, row.dia, row.parte, row.jornada, row.especialidad, row.tipo].map(clean).join("|");
}

function premiumAmount(row) {
  return clean(row?.produccion || row?.prima || row?.importe);
}

function meaningfulAmount(value) {
  return Boolean(clean(value)) && !/^[-—]+$/.test(clean(value));
}

function journalDate(item) {
  const day = Number(item?.row?.dia);
  const label = clean(item?.period).toLowerCase();
  if (!day) return null;
  const numeric = label.match(/\b(0?[1-9]|1[0-2])\s*[\/-]\s*(20\d{2})\b/);
  const namedMonth = MONTHS.findIndex((month) => label.includes(month));
  const year = Number(label.match(/\b(20\d{2})\b/)?.[1]);
  const month = numeric ? Number(numeric[1]) : namedMonth >= 0 ? namedMonth + 1 : 0;
  const resolvedYear = numeric ? Number(numeric[2]) : year;
  if (!month || !resolvedYear) return null;
  return new Date(Date.UTC(resolvedYear, month - 1, day, 12));
}

function recentEnough(item, now) {
  const date = journalDate(item);
  if (!date) return true;
  return date.getTime() >= now.getTime() - 7 * 24 * 60 * 60 * 1000;
}

function notification(eventType, title, body, entityKey, targetTab, metadata = {}) {
  const changeHash = hash({ eventType, entityKey, title, body, metadata });
  return { eventType, title, body, entityKey, changeHash, targetTab, metadata };
}

function canonicalRests(section) {
  return (section?.months || []).map((month) => ({
    year: Number(month?.year) || null,
    month: Number(month?.month) || null,
    days: (month?.days || []).map((day) => ({ day: Number(day?.day), code: clean(day?.code), jle: clean(day?.jle) })).sort((a, b) => a.day - b.day)
  })).sort((a, b) => (a.year - b.year) || (a.month - b.month));
}

function canonicalVacations(section) {
  return (section?.rows || []).map((row) => ({ inicio: clean(row?.inicio), fin: clean(row?.fin), dias: Number(row?.dias) || 0 }))
    .sort((a, b) => `${a.inicio}|${a.fin}`.localeCompare(`${b.inicio}|${b.fin}`, "es"));
}

function canonicalExceptions(section) {
  return (section?.rows || []).map((row) => ({
    date: clean(row?.date), shift: clean(row?.shift), requestedAt: clean(row?.requestedAt), status: clean(row?.status), used: Boolean(row?.used)
  })).sort((a, b) => `${a.date}|${a.shift}|${a.requestedAt}`.localeCompare(`${b.date}|${b.shift}|${b.requestedAt}`, "es"));
}

export function buildPortalNotifications(previousPayload, nextPayload, { now = new Date() } = {}) {
  if (!previousPayload || !nextPayload || nextPayload?.sync?.inProgress) return [];
  const result = [];

  if (Array.isArray(previousPayload?.jornales?.rows) && Array.isArray(nextPayload?.jornales?.rows)) {
    const previous = new Set(periodRows(previousPayload.jornales).map(journalKey));
    for (const item of periodRows(nextPayload.jornales)) {
      const key = journalKey(item);
      if (!previous.has(key) && recentEnough(item, now)) {
        const row = item.row || {};
        result.push(notification(
          "new_journal",
          "Nuevo jornal",
          [row.dia && `${clean(row.dia)} ${clean(item.period)}`, clean(row.jornada), clean(row.especialidad), row.parte && `Parte ${clean(row.parte)}`].filter(Boolean).join(" · "),
          key,
          "contratacion",
          { day: clean(row.dia), period: clean(item.period), shift: clean(row.jornada), specialty: clean(row.especialidad), part: clean(row.parte) }
        ));
      }
    }
  }

  if (previousPayload?.primas?.recognized && !previousPayload?.primas?.locked && nextPayload?.primas?.recognized && !nextPayload?.primas?.locked) {
    const previous = new Map(periodRows(previousPayload.primas).map((item) => [premiumKey(item), premiumAmount(item.row)]));
    for (const item of periodRows(nextPayload.primas)) {
      const key = premiumKey(item);
      const amount = premiumAmount(item.row);
      if (!meaningfulAmount(amount)) continue;
      const row = item.row || {};
      const common = { part: clean(row.parte), amount, previousAmount: clean(previous.get(key)), day: clean(row.dia), period: clean(item.period) };
      if (!previous.has(key) || !meaningfulAmount(previous.get(key))) {
        result.push(notification("new_premium", "Nueva prima", [row.parte && `Parte ${clean(row.parte)}`, amount].filter(Boolean).join(" · "), key, "sueldometro", common));
      } else if (clean(previous.get(key)) !== amount) {
        result.push(notification("premium_modified", "Prima modificada", `${clean(previous.get(key))} → ${amount}${row.parte ? ` · Parte ${clean(row.parte)}` : ""}`, key, "sueldometro", common));
      }
    }
  }

  if (previousPayload?.nominas?.recognized && !previousPayload?.nominas?.locked && nextPayload?.nominas?.recognized && !nextPayload?.nominas?.locked) {
    const previous = new Set((previousPayload.nominas.rows || []).map((row) => clean(row?.id || `${row?.period}|${row?.title}`)));
    for (const row of nextPayload.nominas.rows || []) {
      const key = clean(row?.id || `${row?.period}|${row?.title}`);
      if (key && !previous.has(key)) result.push(notification("new_payroll", "Nueva nómina disponible", clean(row?.title || row?.period || "Documento de nómina"), key, "nominas", { documentId: key, period: clean(row?.period), documentTitle: clean(row?.title) }));
    }
  }

  const oldRests = canonicalRests(previousPayload?.descansos);
  const newRests = canonicalRests(nextPayload?.descansos);
  if (oldRests.length && newRests.length && hash(oldRests) !== hash(newRests)) {
    result.push(notification("rests_changed", "Descansos modificados", "Ha cambiado tu calendario de descansos", "rests-calendar", "descansos", { before: hash(oldRests), after: hash(newRests) }));
  }

  const oldVacations = canonicalVacations(previousPayload?.vacaciones);
  const newVacations = canonicalVacations(nextPayload?.vacaciones);
  if (previousPayload?.vacaciones?.recognized && nextPayload?.vacaciones?.recognized && hash(oldVacations) !== hash(newVacations)) {
    result.push(notification("vacations_changed", "Vacaciones modificadas", "Se han actualizado tus periodos de vacaciones", "vacations-calendar", "vacaciones", { before: hash(oldVacations), after: hash(newVacations) }));
  }

  const oldExceptions = canonicalExceptions(previousPayload?.excepciones);
  const newExceptions = canonicalExceptions(nextPayload?.excepciones);
  if (previousPayload?.excepciones?.recognized && nextPayload?.excepciones?.recognized && hash(oldExceptions) !== hash(newExceptions)) {
    result.push(notification("exceptions_changed", "Excepciones actualizadas", "Ha cambiado el estado o el listado de tus excepciones", "exceptions-list", "excepciones", { before: hash(oldExceptions), after: hash(newExceptions) }));
  }

  return result.slice(0, 50);
}
