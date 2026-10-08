import React, { useMemo, useState } from 'react';
import { CalendarRange, ChevronDown, Clock3, Percent, ReceiptText, RefreshCw, Save, WalletCards } from 'lucide-react';
import { salaryPeriod } from './manualSalary.js';
import { formatEuro } from './payroll.js';

const shortMonths = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const periodNames = { first: '1ª quincena', second: '2ª quincena', month: 'Mes completo' };
const titleCase = (value) => value ? value.charAt(0).toLocaleUpperCase('es-ES') + value.slice(1) : '';

export function ManualSalaryDashboard({ months, monthChoices, chosen, period, onPeriodChange, onMonthChange, onRefresh, irpf, onIrpfChange, onIrpfSave, busy, onAdd, onAddPaidDay, portalAction, children }) {
  const [annualExpanded, setAnnualExpanded] = useState(false);
  const [jornalesExpanded, setJornalesExpanded] = useState(true);
  const year = Number(chosen?.key?.slice(0, 4)) || new Date().getFullYear();
  const annual = useMemo(() => {
    const byMonth = new Map(months.filter((item) => Number(item.key.slice(0, 4)) === year).map((item) => [Number(item.key.slice(5, 7)), item]));
    const entries = Array.from({ length: 12 }, (_, index) => {
      const item = byMonth.get(index + 1);
      return { number: index + 1, count: item?.items?.filter((row) => !row.isVacation && !row.isTraining).length || 0, vacationDays: item?.items?.filter((row) => row.isVacation).length || 0, trainingDays: item?.items?.filter((row) => row.isTraining).length || 0, gross: item?.total || 0 };
    });
    return {
      entries,
      count: entries.reduce((sum, entry) => sum + entry.count, 0),
      vacationDays: entries.reduce((sum, entry) => sum + entry.vacationDays, 0),
      trainingDays: entries.reduce((sum, entry) => sum + entry.trainingDays, 0),
      total: entries.reduce((sum, entry) => sum + entry.gross, 0),
      activeMonths: entries.filter((entry) => entry.count > 0 || entry.vacationDays > 0 || entry.trainingDays > 0).length
    };
  }, [months, year]);
  const first = salaryPeriod(chosen?.items, 'first');
  const second = salaryPeriod(chosen?.items, 'second');
  const selected = salaryPeriod(chosen?.items, period);
  const selectedWorkDays = selected.items.filter((item) => !item.isVacation && !item.isTraining).length;
  const selectedVacationDays = selected.items.filter((item) => item.isVacation).length;
  const selectedTrainingDays = selected.items.filter((item) => item.isTraining).length;
  const selectedCountLabel = `${selectedWorkDays} ${selectedWorkDays === 1 ? 'jornal' : 'jornales'}${selectedVacationDays ? ` + ${selectedVacationDays} VA` : ''}${selectedTrainingDays ? ` + ${selectedTrainingDays} FM` : ''}`;
  const withholding = selected.total * irpf / 100;
  const net = selected.total - withholding;
  const maxCount = Math.max(1, ...annual.entries.map((entry) => entry.count));

  return <>
    <section className="visual-page-heading"><div><span>JORNALES Y SALARIO</span><h1>Sueldómetro</h1></div>{portalAction}</section>
    <p className="visual-manual-notice">Ahora los jornales se añaden manualmente</p>
    <div className="visual-toolbar"><span><Clock3 size={16} /> Historial guardado · consulta manual</span><div><select aria-label="Mes del historial" value={chosen?.key || ''} onChange={(event) => onMonthChange(event.target.value)}>{monthChoices.map((item) => <option key={item.key} value={item.key}>{titleCase(item.label)}</option>)}</select><button type="button" onClick={onRefresh} disabled={busy} title="Actualizar historial" aria-label="Actualizar historial"><RefreshCw size={17} /></button><button type="button" className="visual-add-paid" onClick={onAddPaidDay}>+ Día VA / FM</button><button type="button" className="visual-add" onClick={onAdd}>+ Añadir jornal</button></div></div>
    <section className="visual-salary-card" aria-label="Extracto salarial">
      <div className="visual-salary-hero">
        <div className="visual-hero-heading"><div className="visual-hero-title"><span className="visual-hero-icon"><WalletCards size={25} /></span><div><small>Extracto salarial</small><strong>{titleCase(chosen?.label || new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date()))}</strong></div></div><span className="visual-period-label">{periodNames[period]}</span></div>
        <div className="visual-hero-main"><div><span>Neto estimado</span><strong>{formatEuro(net)}</strong><small>{selectedCountLabel} · IRPF {irpf}%</small></div><div className="visual-irpf-ring" style={{ '--salary-progress': `${Math.max(0, Math.min(100, 100 - irpf)) * 3.6}deg` }}><span>{irpf}%</span><small>IRPF</small></div></div>
        <div className="visual-hero-metrics"><div><span><ReceiptText size={17} /> Bruto</span><strong>{formatEuro(selected.total)}</strong></div><div><span><Percent size={17} /> Retención</span><strong>-{formatEuro(withholding)}</strong></div></div>
      </div>
      <div className="visual-period-tabs" role="group" aria-label="Ver salario por periodo">{[['first', first.total], ['second', second.total], ['month', first.total + second.total]].map(([key, amount]) => <button key={key} className={period === key ? 'is-active' : ''} type="button" aria-pressed={period === key} onClick={() => onPeriodChange(key)}><span>{periodNames[key]}</span><strong>{formatEuro(amount)}</strong></button>)}</div>
      <section className={`visual-annual${annualExpanded ? ' is-open' : ''}`}><button className="visual-accordion-button" type="button" onClick={() => setAnnualExpanded((value) => !value)} aria-expanded={annualExpanded}><span className="visual-annual-title"><CalendarRange size={25} /><span><small>Resumen anual</small><strong>{year}</strong></span></span><span className="visual-annual-total"><strong>{annual.count} {annual.count === 1 ? 'jornal' : 'jornales'}{annual.vacationDays ? ` + ${annual.vacationDays} VA` : ''}{annual.trainingDays ? ` + ${annual.trainingDays} FM` : ''}</strong><small>{formatEuro(annual.total)} bruto</small></span><ChevronDown size={21} /></button>
        {annualExpanded && <div className="visual-annual-content"><div className="visual-annual-kpis"><div><span>Número de jornales</span><strong>{annual.count}</strong></div>{annual.vacationDays > 0 && <div><span>Días de vacaciones</span><strong>{annual.vacationDays}</strong></div>}{annual.trainingDays > 0 && <div><span>Días de formación</span><strong>{annual.trainingDays}</strong></div>}<div><span>Bruto anual</span><strong>{formatEuro(annual.total)}</strong></div><div><span>Media mensual</span><strong>{formatEuro(annual.activeMonths ? annual.total / annual.activeMonths : 0)}</strong></div><div><span>Neto anual</span><strong>{formatEuro(annual.total * (1 - irpf / 100))}</strong></div></div><div className="visual-annual-chart" aria-label="Jornales por mes">{annual.entries.map((entry) => <button key={entry.number} type="button" onClick={() => onMonthChange(`${year}-${String(entry.number).padStart(2, '0')}`)} title={`${shortMonths[entry.number - 1]}: ${entry.count} jornales`} aria-label={`Ver ${shortMonths[entry.number - 1]}, ${entry.count} jornales`}><span>{entry.count || ''}</span><i style={{ height: `${Math.max(entry.count ? 12 : 2, entry.count / maxCount * 72)}px` }} /><small>{shortMonths[entry.number - 1]}</small></button>)}</div></div>}
      </section>
      <section className="visual-irpf"><strong>Ajuste de IRPF</strong><span><input aria-label="Porcentaje de IRPF" type="number" min="0" max="60" step="0.01" value={irpf} onChange={(event) => onIrpfChange(Number(event.target.value))} /><b>%</b></span><button type="button" onClick={onIrpfSave} disabled={busy} aria-label="Guardar IRPF"><Save size={18} /></button></section>
      <section className="visual-journals"><button className="visual-journal-heading" type="button" onClick={() => setJornalesExpanded((value) => !value)} aria-expanded={jornalesExpanded}><span><ReceiptText size={20} /> Desglose de jornales</span><small>{selectedCountLabel} <ChevronDown size={18} /></small></button>{jornalesExpanded && <div className="visual-journal-content">{children}</div>}</section>
    </section>
  </>;
}
