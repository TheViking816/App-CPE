const pad = (value) => String(value).padStart(2, '0');
export const UPCOMING_PILOT_CHAPA = '72683';
export const UPCOMING_PREVIEW_CHANNEL = 'upcoming-contracts-72683';

export function assignmentDateKey(value) {
  const text = String(value || '').trim();
  const iso = text.match(/^(20\d{2})-?(\d{2})-?(\d{2})(?:T.*)?$/);
  const local = text.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  const parts = iso ? [+iso[1], +iso[2], +iso[3]] : local ? [+local[3], +local[2], +local[1]] : null;
  if (!parts) return '';
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() + 1 === parts[1] && date.getUTCDate() === parts[2]
    ? `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}` : '';
}
export function assignmentShift(value) {
  const match = String(value || '').match(/(\d{1,2})\s*(?:A|-|–|\/)\s*(\d{1,2})/i);
  return match ? `${pad(match[1])}-${pad(match[2])}` : '';
}
export function madridDateKey(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function assignmentKey(row) {
  return [assignmentDateKey(row.fecha), assignmentShift(row.jornada), String(row.parte || '').trim()].join('|');
}
export function validateUpcomingReading(value, expectedChapa = UPCOMING_PILOT_CHAPA) {
  if (value?.schemaVersion !== 1 || value?.kind !== 'upcoming-assignments' || !/^\d{5}$/.test(String(expectedChapa)) || String(value.chapa) !== String(expectedChapa) || !Array.isArray(value.rows) || value.rows.length > 100)
    throw new Error('La lectura debe corresponder a la cuenta solicitada.');
  const rows = value.rows.map((row) => {
    if (!assignmentDateKey(row.fecha) || !assignmentShift(row.jornada) || !/^\d{1,10}$/.test(String(row.parte || '')))
      throw new Error('La lectura contiene un parte sin fecha o jornada válida.');
    const detail = row.detail;
    if (!detail?.recognized || String(detail.parte) !== String(row.parte) || !Array.isArray(detail.specialties) || !detail.specialties.length)
      throw new Error(`El equipo del parte ${row.parte} está incompleto en el archivo.`);
    if (assignmentDateKey(detail.fecha) !== assignmentDateKey(row.fecha) || assignmentShift(detail.jornada) !== assignmentShift(row.jornada))
      throw new Error(`La fecha o jornada del parte ${row.parte} no coincide.`);
    for (const group of detail.specialties) {
      if (!group.name || !Array.isArray(group.workers) || group.workers.some((worker) => !/^\d{4,8}$/.test(String(worker.code || ''))))
        throw new Error(`El equipo del parte ${row.parte} no es válido.`);
    }
    return { ...row, fecha: assignmentDateKey(row.fecha), jornada: assignmentShift(row.jornada) };
  });
  return { schemaVersion: 1, kind: value.kind, chapa: String(expectedChapa), updatedAt: String(value.updatedAt || ''), rows };
}
export function upcomingAssignments({ snapshot, reading, today = madridDateKey() } = {}) {
  const journal = snapshot?.payload?.jornales || {};
  const months = [...(journal.history || []), ...(journal.year && journal.month ? [journal] : [])];
  const source = months.flatMap(({ year, month, rows = [] }) => rows.map((row) => ({ ...row, fecha: `${year}-${pad(month)}-${pad(row.dia)}` })));
  source.push(...(snapshot?.payload?.asignaciones?.rows || []), ...(reading?.rows || []));
  const bySlot = new Map();
  for (const row of source) {
    const fecha = assignmentDateKey(row.fecha), jornada = assignmentShift(row.jornada);
    if (!fecha || fecha < today || !jornada || !/^\d+$/.test(String(row.parte || ''))) continue;
    const key = `${fecha}|${jornada}`;
    const previous = bySlot.get(key);
    const fields = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== '' && value != null));
    bySlot.set(key, { ...previous, ...fields, fecha, jornada,
      detail: fields.detail || (String(previous?.parte) === String(row.parte) ? previous?.detail : undefined) });
  }
  return [...bySlot.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.jornada.localeCompare(b.jornada));
}
