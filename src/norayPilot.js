import { unpackManualNotes } from './manualMetadata.js';
import { dateRangeKeys } from './vacationExchange.js';
import { supabase } from './supabaseClient.js';

const pad = (value) => String(value).padStart(2, '0');
const clean = (value) => String(value || '').trim().toUpperCase();
const shift = (value) => {
  const match = String(value || '').match(/(\d{1,2})\D+(\d{1,2})/);
  return match ? `${pad(match[1])}-${pad(match[2])}` : clean(value);
};

export async function loadNorayPilotSnapshot(chapa, token) {
  if (token && supabase) {
    const { data, error } = await supabase.rpc('app_cpe_get_personal_noray_snapshot', { p_token: token });
    if (!error && data?.schemaVersion === 1 && String(data.chapa) === String(chapa)) return data;
  }
  if (String(chapa) !== '72683' || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return null;
  const response = await fetch(`${import.meta.env.BASE_URL}__local/noray-pilot-72683.json`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('No se pudo leer la prueba local de Noray.');
  const value = await response.json();
  return value?.schemaVersion === 1 && value?.chapa === '72683' ? value : null;
}

export function mergeNorayPilotSalary(snapshot, manualRows = [], pilot) {
  if (!pilot?.journals) return snapshot;
  const manuallySaved = manualRows.map((row) => {
    const details = unpackManualNotes(row.notes);
    return { date: String(row.work_date || ''), part: String(details.part || ''),
      shift: shift(row.shift), specialty: clean(row.specialty), vessel: clean(details.vessel || row.vessel) };
  });
  const matchedManualRows = new Set();
  const payload = snapshot?.payload || {};
  const previous = payload.jornales || {};
  const importedMonths = pilot.journalHistory || [pilot.journals];
  const importedKeys = new Set(importedMonths.map(({ year, month }) => `${year}-${month}`));
  const history = (previous.history || []).filter((period) => !importedKeys.has(`${period.year}-${period.month}`));
  for (const { year, month, rows: importedRows = [] } of importedMonths) {
    const label = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
    const rows = importedRows.filter((row) => {
      const date = `${year}-${pad(month)}-${pad(row.dia)}`;
      const match = manuallySaved.findIndex((manual, index) => {
        if (matchedManualRows.has(index) || manual.date !== date) return false;
        if (manual.part) return manual.part === String(row.parte || '');
        if (manual.shift !== shift(row.jornada) || manual.specialty !== clean(row.especialidad)) return false;
        return !manual.vessel || manual.vessel === clean(row.buque);
      });
      if (match < 0) return true;
      matchedManualRows.add(match);
      return false;
    });
    history.push({ year, month, monthLabel: label, rows });
  }
  history.sort((a, b) => Number(a.year) - Number(b.year) || Number(a.month) - Number(b.month));
  const { year, month } = pilot.journals;
  const rows = history.find((period) => Number(period.year) === year && Number(period.month) === month)?.rows || [];
  const label = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
  return { ...snapshot, payload: { ...payload, jornales: { ...previous, recognized: true, year,
    monthLabel: label, rows, history } } };
}

export function norayPilotCalendar(pilot) {
  if (!pilot?.chapa || pilot.schemaVersion !== 1) return { officialDays: {}, vacationPeriods: [], header: null };
  const officialDays = Object.fromEntries((pilot.rests?.days || []).map((day) => [day.date, day.code]));
  const vacationPeriods = pilot.vacations?.periods || [];
  for (const period of vacationPeriods) {
    for (const date of dateRangeKeys(period.start, period.end)) officialDays[date] = 'VA';
  }
  return { officialDays, vacationPeriods, header: { ...pilot.rests?.header,
    year: pilot.rests?.year, monthNumber: pilot.rests?.month } };
}
