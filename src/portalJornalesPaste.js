import { getRemateGroup } from './payroll.js';
import { packManualNotes, unpackManualNotes } from './manualMetadata.js';

const MONTHS = Object.freeze({
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12
});
const SHIFTS = new Set(['02-08', '06-12', '08-14', '14-20', '18-00', '19-01', '20-02']);
const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const clean = (value) => String(value || '').replace(/\u00a0/g, ' ').trim();
const identity = ({ work_date, part, shift }) => `${work_date}|${part}|${shift}`;
const dayFingerprint = ({ work_date, shift, specialty, company, vessel }) =>
  [work_date, shift, specialty, company, vessel].map(normalize).join('|');

function parseShift(value) {
  const match = clean(value).match(/(?:DE\s*)?(\d{1,2})\s*(?:A|[-–])\s*(\d{1,2})(?:\s*H\.?)?/i);
  if (!match) return '';
  const shift = `${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return SHIFTS.has(shift) ? shift : '';
}

function parsePremium(value) {
  const text = clean(value);
  if (!text || /^(?:—|–|-|--)$/u.test(text)) return null;
  if (!/^(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{1,2})?\s*€?$/u.test(text)) throw new Error(`Prima no reconocida: ${text}`);
  return Number(text.replace(/\./g, '').replace(',', '.').replace(/€|\s/g, ''));
}

export function parsePortalJornalesPaste(value) {
  const lines = String(value || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').split('\n');
  const monthHeaders = lines.map((line) => clean(line).match(/^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(20\d{2})$/i)).filter(Boolean);
  if (monthHeaders.length !== 1) throw new Error('Copia un solo mes e incluye el título, por ejemplo «Octubre 2026».');
  const month = MONTHS[monthHeaders[0][1].toLowerCase()];
  const year = Number(monthHeaders[0][2]);
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const countLine = lines.find((line) => /Jornales del mes\s*:/i.test(line));
  const expected = countLine ? Number(countLine.match(/Jornales del mes\s*:\s*(\d+)/i)?.[1]) : null;
  const headerIndex = lines.findIndex((line) => {
    const cells = line.split('\t').map((cell) => normalize(cell));
    return cells[0] === '#' && cells[1] === 'PARTE' && cells[2] === 'DIA' && cells.includes('JORNADA') && cells.includes('PROD.');
  });
  if (headerIndex < 0) throw new Error('No se encontró la tabla. Copia el encabezado «# Parte Dia Tipo Jornada… Prod.» y sus filas.');
  const rows = [];
  const errors = [];
  for (const [offset, line] of lines.slice(headerIndex + 1).entries()) {
    if (!clean(line)) continue;
    const cells = line.split('\t').map(clean);
    if (!/^\d+$/.test(cells[0])) continue;
    const lineNumber = headerIndex + offset + 2;
    if (cells.length < 9 || cells.length > 10) { errors.push(`Fila ${cells[0]}: se esperaban 10 columnas (línea ${lineNumber}).`); continue; }
    const [, part, dayText, portalType, shiftText, specialty, company, vesselText, operation, premiumText = ''] = cells;
    const day = Number(dayText);
    const shift = parseShift(shiftText);
    const workDate = `${monthKey}-${String(day).padStart(2, '0')}`;
    const date = new Date(year, month - 1, day);
    if (!/^\d{1,12}$/.test(part) || !Number.isInteger(day) || day < 1 || date.getMonth() !== month - 1 || !shift || !specialty || specialty.length > 100 || !portalType) {
      errors.push(`Fila ${cells[0]}: parte, fecha, turno o especialidad no válidos.`); continue;
    }
    const normalizedOperation = normalize(operation);
    if (!normalizedOperation) { errors.push(`Fila ${cells[0]}: falta la operación.`); continue; }
    const operationType = /RECEPCION\s*(?:\/|Y)?\s*ENTREGA/.test(normalizedOperation) ? 'RECEPCION_ENTREGA' : 'ESTIBA';
    try {
      const premium = parsePremium(premiumText);
      const vessel = /^(?:—|–|-|--)$/u.test(vesselText) ? '' : vesselText;
      const row = { part, work_date: workDate, shift, portalType, specialty, company, vessel, operation,
        operation_type: operationType, worker_group: getRemateGroup(specialty), premium };
      packManualNotes({ ...row, source: 'portal_paste', premiumKnown: premium !== null });
      rows.push(row);
    } catch (error) { errors.push(`Fila ${cells[0]}: ${error.message}`); }
  }
  if (!rows.length && !errors.length) errors.push('No se encontraron filas de jornales.');
  if (expected !== null && expected !== rows.length + errors.length) errors.push(`La página indica ${expected} jornales, pero se encontraron ${rows.length + errors.length}. Copia el mes completo.`);
  return { monthKey, expected, rows, errors,
    premiumsHidden: /Para ver las primas/i.test(value) || rows.every((row) => row.premium === null),
    premiumsPending: rows.filter((row) => row.premium === null && row.operation_type !== 'RECEPCION_ENTREGA').length };
}

export function planPortalJornalesImport(parsed, existingItems = [], manualRows = []) {
  const originals = new Map(manualRows.map((row) => [row.id, row]));
  const byIdentity = new Map();
  const byPart = new Map();
  const byFingerprint = new Set();
  const withoutPart = new Set();
  for (const item of existingItems) {
    if (item.isVacation || item.isTraining) continue;
    const original = item.source === 'manual' ? originals.get(item.id) : null;
    const details = original ? unpackManualNotes(original.notes) : null;
    const part = clean(details?.part || item.manualPart || item.parte);
    const existing = { item, original, details, part };
    if (part) {
      const key = identity({ work_date: item.payroll.date, part, shift: item.payroll.shift });
      if (!byIdentity.has(key) || item.source === 'historico') byIdentity.set(key, existing);
      byPart.set(part, existing);
    } else withoutPart.add([item.payroll.date, item.payroll.shift, normalize(item.especialidad)].join('|'));
    byFingerprint.add(dayFingerprint({ work_date: item.payroll.date, shift: item.payroll.shift,
      specialty: item.especialidad, company: details?.company || item.empresa, vessel: details?.vessel || item.buque }));
  }
  const seen = new Set();
  const seenParts = new Set();
  const actions = [];
  const stats = { newCount: 0, premiumUpdates: 0, existingCount: 0, repeatedCount: 0, conflicts: [] };
  for (const row of parsed.rows) {
    const key = identity({ ...row, part: row.part });
    if (seen.has(key)) { stats.repeatedCount++; continue; }
    seen.add(key);
    if (seenParts.has(row.part)) { stats.conflicts.push(`La parte ${row.part} aparece más de una vez en la copia.`); continue; }
    seenParts.add(row.part);
    const exact = byIdentity.get(key);
    if (exact) {
      if (exact.original && exact.details?.source === 'portal_paste' && !exact.details.premiumKnown && row.premium !== null) {
        actions.push({ kind: 'premium', row, original: exact.original }); stats.premiumUpdates++;
      } else stats.existingCount++;
      continue;
    }
    if (byPart.has(row.part) || byFingerprint.has(dayFingerprint(row)) || withoutPart.has([row.work_date, row.shift, normalize(row.specialty)].join('|'))) {
      stats.conflicts.push(`Parte ${row.part} · ${row.work_date}: podría duplicar un jornal existente.`);
      continue;
    }
    actions.push({ kind: 'create', row }); stats.newCount++;
  }
  return { actions, ...stats };
}
