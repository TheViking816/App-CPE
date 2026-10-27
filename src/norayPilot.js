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

export async function loadNorayPilotPremiums(chapa, token) {
  if (!token || !supabase) return null;
  const { data, error } = await supabase.rpc('app_cpe_mobile_get_my_salary_premiums', { p_token: token });
  if (error) throw error;
  return data?.schemaVersion === 1 && String(data.chapa) === String(chapa) ? data : null;
}

export function mergeNorayPilotSalary(snapshot, manualRows = [], pilot, premiumPilot = null) {
  if (!pilot?.journals) return snapshot;
  const premiumRows = premiumPilot?.chapa === pilot.chapa && Array.isArray(premiumPilot?.rows) ? premiumPilot.rows : [];
  const premiumsByPart = new Map(premiumRows.map((row) => [String(row.part), row]));
  const premiumsBySlot = {};
  for (const row of premiumRows) {
    const slot = `${row.date}|${shift(row.shift)}`;
    if (premiumsBySlot[slot] === undefined) premiumsBySlot[slot] = row;
    else premiumsBySlot[slot] = null;
  }
  const importedSlots = new Set();
  const payload = snapshot?.payload || {};
  const previous = payload.jornales || {};
  const importedMonths = pilot.journalHistory || [pilot.journals];
  const importedKeys = new Set(importedMonths.map(({ year, month }) => `${year}-${month}`));
  const history = (previous.history || []).filter((period) => !importedKeys.has(`${period.year}-${period.month}`));
  for (const { year, month, rows: importedRows = [] } of importedMonths) {
    const label = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
    const previousMonth = (previous.history || []).find((period) => Number(period.year) === Number(year) && Number(period.month) === Number(month));
    const savedRows = previousMonth?.rows || (String(previous.monthLabel || '').toLowerCase() === label.toLowerCase() ? previous.rows || [] : []);
    const sourceSlots = new Set(importedRows.map((row) => `${year}-${pad(month)}-${pad(row.dia)}|${shift(row.jornada)}`));
    const rows = [...savedRows.filter((row) => !sourceSlots.has(`${year}-${pad(month)}-${pad(row.dia)}|${shift(row.jornada)}`)), ...importedRows].filter((row) => {
      const date = `${year}-${pad(month)}-${pad(row.dia)}`;
      const slot = `${date}|${shift(row.jornada)}`;
      if (importedSlots.has(slot)) return false;
      importedSlots.add(slot);
      return true;
    }).map((row) => {
      const slot = `${year}-${pad(month)}-${pad(row.dia)}|${shift(row.jornada)}`;
      const byPart = premiumsByPart.get(String(row.parte));
      const premium = byPart?.date.startsWith(`${year}-${pad(month)}-`) ? byPart : premiumsBySlot[slot];
      return premium && Number(premium.amount) > 0
        ? { ...row, produccion: String(premium.amount), produccionEstado: premium.status || 'verified' }
        : row;
    });
    history.push({ year, month, monthLabel: label, rows });
  }
  history.sort((a, b) => Number(a.year) - Number(b.year) || Number(a.month) - Number(b.month));
  const { year, month } = pilot.journals;
  const rows = history.find((period) => Number(period.year) === year && Number(period.month) === month)?.rows || [];
  const label = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
  return { ...snapshot, payload: { ...payload, jornales: { ...previous, recognized: true, year,
    monthLabel: label, rows, history }, norayPremiumsBySlot: premiumsBySlot,
    norayJournalSlots: [...importedSlots] } };
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
