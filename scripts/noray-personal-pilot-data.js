import { mapNorayJournalRows } from './portal-noray-current.js';

const DAY_CODES = new Set(['DS', 'FS', 'VA', 'FM', 'PA', 'FH', 'SL', 'IT']);
const pad = (value) => String(value).padStart(2, '0');

export function buildNorayPilotSnapshot({ chapa, year, month, base, vigentes, restHeader, restMonth, worker, vacationSummary, updatedAt }) {
  if (!/^[0-9]{5}$/.test(String(chapa))) throw new Error('Chapa no válida.');
  if (Number(restMonth?.anyo) !== year || Number(restMonth?.mes) !== month || !Array.isArray(restMonth?.dias))
    throw new Error('El calendario de descansos no corresponde al mes solicitado.');
  if (Number(vacationSummary?.anyo) !== year || !Array.isArray(vacationSummary?.periodos))
    throw new Error('El resumen de vacaciones no corresponde al año solicitado.');
  const rows = mapNorayJournalRows(base?.jornales || [], vigentes?.jornales || []);
  const days = restMonth.dias.map((day) => ({
    date: `${year}-${pad(month)}-${pad(day.dia)}`,
    code: DAY_CODES.has(String(day.codigo || '').toUpperCase()) ? String(day.codigo).toUpperCase() : ''
  }));
  const periods = vacationSummary.periodos.map((period) => ({
    start: String(period.fecha_inicio || '').slice(0, 10),
    end: String(period.fecha_fin || '').slice(0, 10),
    days: Number(period.dias) || 0
  })).filter((period) => /^\d{4}-\d{2}-\d{2}$/.test(period.start) && /^\d{4}-\d{2}-\d{2}$/.test(period.end));
  return {
    schemaVersion: 1, chapa: String(chapa), updatedAt,
    journals: { year, month, rows },
    rests: {
      year, month,
      header: {
        groupVacation: String(worker?.grupo_descanso_vac || ''),
        groupWeekly: String(worker?.grupo_descanso_sem || ''),
        fsMonth: { used: Number(restHeader?.fs_mes?.consumidos) || 0, max: Number(restHeader?.fs_mes?.maximo) || 0 },
        fsYear: { used: Number(restHeader?.fs_anyo?.consumidos) || 0, max: Number(restHeader?.fs_anyo?.maximo) || 0 },
        month: { name: String(restHeader?.nombre_mes_actual || ''), current: Number(restHeader?.descansos_mes_actual?.actual) || 0,
          min: Number(restHeader?.descansos_mes_actual?.minimo) || 0, max: Number(restHeader?.descansos_mes_actual?.maximo) || 0 }
      },
      days
    },
    vacations: { year, periods }
  };
}

export function compareNorayPilotSnapshots(previous, current) {
  const key = (row) => [current.journals.year, current.journals.month, row.dia, row.jornada, row.parte].join('|');
  const sameMonth = previous?.journals?.year === current.journals.year
    && previous?.journals?.month === current.journals.month;
  const oldJournals = new Set((sameMonth ? previous.journals.rows : []).map(key));
  const oldDays = new Map((previous?.rests?.days || []).map((day) => [day.date, day.code]));
  const oldVacations = new Set((previous?.vacations?.periods || []).map((period) => `${period.start}|${period.end}`));
  return {
    newJournals: current.journals.rows.filter((row) => !oldJournals.has(key(row))).length,
    changedRestDays: current.rests.days.filter((day) => oldDays.has(day.date) && oldDays.get(day.date) !== day.code).length,
    newVacationPeriods: current.vacations.periods.filter((period) => !oldVacations.has(`${period.start}|${period.end}`)).length
  };
}
