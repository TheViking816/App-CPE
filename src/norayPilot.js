import { unpackManualNotes } from './manualMetadata.js';
import { dateRangeKeys } from './vacationExchange.js';

const pad = (value) => String(value).padStart(2, '0');
const clean = (value) => String(value || '').trim().toUpperCase();
const shift = (value) => {
  const match = String(value || '').match(/(\d{1,2})\D+(\d{1,2})/);
  return match ? `${pad(match[1])}-${pad(match[2])}` : clean(value);
};

export async function loadNorayPilotSnapshot(chapa) {
  if (String(chapa) !== '72683' || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return null;
  const response = await fetch(`${import.meta.env.BASE_URL}__local/noray-pilot-72683.json`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('No se pudo leer la prueba local de Noray.');
  const value = await response.json();
  return value?.schemaVersion === 1 && value?.chapa === '72683' ? value : null;
}

export function mergeNorayPilotSalary(snapshot, manualRows = [], pilot) {
  if (!pilot?.journals?.rows?.length) return snapshot;
  const { year, month } = pilot.journals;
  const label = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
  const manuallySaved = manualRows.map((row) => ({
    date: String(row.work_date || ''), part: String(unpackManualNotes(row.notes).part || ''),
    shift: shift(row.shift), specialty: clean(row.specialty), vessel: clean(row.vessel)
  }));
  const rows = pilot.journals.rows.filter((row) => {
    const date = `${year}-${pad(month)}-${pad(row.dia)}`;
    return !manuallySaved.some((manual) => manual.date === date && (
      manual.part && manual.part === String(row.parte || '')
        || manual.shift === shift(row.jornada) && manual.specialty === clean(row.especialidad)
          && manual.vessel && manual.vessel === clean(row.buque)
    ));
  });
  const payload = snapshot?.payload || {};
  const previous = payload.jornales || {};
  const history = (previous.history || []).filter((period) => !(Number(period.year) === year && Number(period.month) === month));
  history.push({ year, month, monthLabel: label, rows });
  history.sort((a, b) => Number(a.year) - Number(b.year) || Number(a.month) - Number(b.month));
  return { ...snapshot, payload: { ...payload, jornales: { ...previous, recognized: true, year,
    monthLabel: label, rows, history } } };
}

export function norayPilotCalendar(pilot) {
  if (!pilot || pilot.chapa !== '72683') return { officialDays: {}, vacationPeriods: [], header: null };
  const officialDays = Object.fromEntries((pilot.rests?.days || []).map((day) => [day.date, day.code]));
  const vacationPeriods = pilot.vacations?.periods || [];
  for (const period of vacationPeriods) {
    for (const date of dateRangeKeys(period.start, period.end)) officialDays[date] = 'VA';
  }
  return { officialDays, vacationPeriods, header: { ...pilot.rests?.header,
    year: pilot.rests?.year, monthNumber: pilot.rests?.month } };
}
