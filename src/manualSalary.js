import { enrichJornales, selectPortalJornales, selectPortalJornalesHistory } from './payroll.js';
import { unpackManualNotes } from './manualMetadata.js';

const pad = (value) => String(value).padStart(2, '0');
const monthName = (year, month) => new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
const money = (value) => Number(Number(value || 0).toFixed(2));
const monthNumbers = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [monthName(2026, index + 1).split(' ')[0], index + 1]));

export function salaryPeriod(items = [], period = 'month') {
  const filtered = period === 'month' ? items : items.filter((item) => {
    const day = Number(item.payroll?.date?.slice(-2));
    return period === 'first' ? day <= 15 : day > 15;
  });
  return {
    items: filtered,
    total: money(filtered.reduce((sum, item) => sum + Number(item.payroll?.total || 0), 0)),
    premiums: money(filtered.reduce((sum, item) => sum + Number(item.payroll?.prima || 0), 0))
  };
}

export function companyImage(company = '') {
  const value = String(company).toUpperCase();
  const base = `${import.meta.env?.BASE_URL || '/'}assets/empresas/`;
  if (/CSP/.test(value)) return `${base}csp.jpeg`;
  if (/APM/.test(value)) return `${base}apm.jpeg`;
  if (/MSC|MEDITERRANEAN/.test(value)) return `${base}msc.jpeg`;
  if (/VTEU|VALENCIA TERMINAL EUROPA|GRIMALDI/.test(value)) return `${base}vteu.jpeg`;
  if (/ERH|ERSHIP|EUROPEA DE HANDLING/.test(value)) return `${base}erh.png`;
  if (/BALE[AÀ]RIA/.test(value)) return `${base}balearia.png`;
  if (/TRASMED/.test(value)) return `${base}trasmed.png`;
  if (/SEVASA|CPE/.test(value)) return `${base}cpe.jpg`;
  return '';
}

export function buildManualSalaryMonths(snapshot, manualRows = [], payrollConfig = null, manualPremiums = {}, relayHours = {}, remateHours = {}) {
  const payload = snapshot?.payload || {};
  const historic = selectPortalJornalesHistory(payload.jornales, payload.primas);
  const current = selectPortalJornales(payload.jornales, payload.primas);
  const currentLabel = payload.jornales?.monthLabel || payload.primas?.monthLabel || '';
  const months = new Map();

  for (const period of historic) {
    const year = Number(period.year);
    const month = Number(period.month);
    if (!year || !month || !Array.isArray(period.rows)) continue;
    months.set(`${year}-${pad(month)}`, { year, month, monthLabel: period.monthLabel || monthName(year, month), rows: period.rows });
  }
  const currentMatch = String(currentLabel).match(/(\d{1,2})\s*\/\s*(\d{4})/);
  const monthMatch = String(currentLabel).toLocaleLowerCase('es').match(/([a-záéíóúñ]+)\s+de\s+(\d{4})/);
  const currentDate = currentMatch
    ? new Date(Number(currentMatch[2]), Number(currentMatch[1]) - 1, 1)
    : monthMatch && monthNumbers[monthMatch[1]] ? new Date(Number(monthMatch[2]), monthNumbers[monthMatch[1]] - 1, 1) : null;
  if (current.length && currentDate && !Number.isNaN(currentDate.getTime())) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    months.set(`${year}-${pad(month)}`, { year, month, monthLabel: currentLabel, rows: current });
  }

  for (const row of manualRows) {
    const match = String(row.work_date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) continue;
    const [, yearText, monthText] = match;
    const key = `${yearText}-${monthText}`;
    if (!months.has(key)) months.set(key, { year: Number(yearText), month: Number(monthText), monthLabel: monthName(Number(yearText), Number(monthText)), rows: [] });
  }

  return [...months.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([key, period]) => {
    const savedPremiumRows = (payload.primas?.history || []).find((item) => Number(item.year) === period.year && Number(item.month) === period.month)?.rows
      || (String(payload.primas?.monthLabel || '').toLowerCase() === String(period.monthLabel).toLowerCase() ? payload.primas?.rows || [] : []);
    const historicItems = enrichJornales(period.rows, savedPremiumRows, period.monthLabel, payrollConfig, relayHours, remateHours, manualPremiums)
      .map((item) => {
        const saved = manualPremiums[item.payroll.manualPremiumKey];
        const amount = Number(saved?.amount);
        if (saved == null || !Number.isFinite(amount) || item.payroll.manualPrima != null) return { ...item, source: 'historico' };
        const premium = money(amount);
        return { ...item, source: 'historico', payroll: { ...item.payroll, prima: premium,
          manualPrima: premium, primaSource: 'manual', primaPending: false,
          total: money(item.payroll.total - (item.payroll.prima || 0) + premium) } };
      });
    const newItems = manualRows.filter((row) => String(row.work_date).startsWith(key)).map((row) => {
      const details = unpackManualNotes(row.notes);
      const raw = { dia: Number(row.work_date.slice(-2)), jornada: row.shift, especialidad: row.specialty,
        payrollGroup: row.worker_group, operacion: row.operation_type === 'RECEPCION_ENTREGA' ? 'RECEPCION Y ENTREGA' : 'ESTIBA',
        parte: `MANUAL-${row.id}`, empresa: row.company || details.company, buque: row.vessel || details.vessel, produccion: '' };
      const calculated = enrichJornales([raw], [], period.monthLabel, payrollConfig)[0];
      const premium = money(row.premium);
      return { ...calculated, id: row.id, notes: details.notes, source: 'manual', payroll: {
        ...calculated.payroll, prima: premium, manualPrima: premium, primaSource: 'manual', primaPending: false,
        total: money(calculated.payroll.total + premium)
      } };
    });
    const items = [...historicItems, ...newItems].sort((a, b) => b.payroll.date.localeCompare(a.payroll.date) || b.payroll.shift.localeCompare(a.payroll.shift));
    return { key, label: period.monthLabel, items, total: money(items.reduce((sum, item) => sum + item.payroll.total, 0)),
      premiums: money(items.reduce((sum, item) => sum + (item.payroll.prima || 0), 0)) };
  });
}
