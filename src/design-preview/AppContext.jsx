// Preview-only copies of the existing app components. Keep production App.jsx unchanged.
import { useMemo, useState, useEffect } from "react";
import { Menu, Bell, Home, ClipboardList, WalletCards, CalendarDays, Sun, ExternalLink } from "lucide-react";
import { buildPersonalRestMonths } from "../restCalendar.js";
import { PORTAL_HOME_URL } from "../portalLinks.js";
import annualRestCalendarUrl from "../../assets/descansos-Bef4loCk.jpg";
const BOTTOM_NAV_ITEMS = [
  { id: "inicio", label: "Inicio", Icon: Home },
  { id: "contratacion", label: "Contratación", Icon: ClipboardList },
  { id: "sueldometro", label: "Sueldómetro", Icon: WalletCards },
  { id: "descansos", label: "Descansos", Icon: CalendarDays },
  { id: "vacaciones", label: "Vacaciones", Icon: Sun }
 ];
function AppHeader({ onMenuOpen, unreadNotifications = 0, onNotificationsOpen }) {
  return (
    <header className="app-header">
      <button className="header-menu-button" type="button" onClick={onMenuOpen} aria-label="Abrir menú">
        <Menu size={23} />
      </button>
      <div className="logo-box">
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="App CPE" />
      </div>
      <div className="header-title">
        <strong>App CPE</strong>
      </div>
      <button className="header-notifications-button" type="button" onClick={onNotificationsOpen} aria-label={`Abrir novedades${unreadNotifications ? `, ${unreadNotifications} sin leer` : ""}`}>
        <Bell size={23} />
        {unreadNotifications > 0 && <span>{Math.min(99, unreadNotifications)}</span>}
      </button>
    </header>
  );
}


const WEEKDAYS_ES = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function parsePortalDate(value) {
  const normalized = String(value || "").trim();
  const dayFirst = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const yearFirst = normalized.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!dayFirst && !yearFirst) return null;
  const year = Number(dayFirst?.[3] || yearFirst?.[1]);
  const month = Number(dayFirst?.[2] || yearFirst?.[2]);
  const day = Number(dayFirst?.[1] || yearFirst?.[3]);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatShortPortalDate(value) {
  const date = parsePortalDate(value);
  return date
    ? `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`
    : String(value || "").slice(0, 5);
}

function formatVacationRange(period) {
  const start = parsePortalDate(period?.inicio);
  const end = parsePortalDate(period?.fin);
  if (!start || !end) return [period?.inicio, period?.fin].filter(Boolean).join(" - ");
  const startLabel = `${start.getDate()} ${MONTHS_ES[start.getMonth()]}`;
  const endLabel = `${end.getDate()} ${MONTHS_ES[end.getMonth()]}`;
  return start.getTime() === end.getTime() ? startLabel : `${startLabel} - ${endLabel}`;
}

function PortalVacationPreview({ vacaciones, onDaySelect, selectedDay }) {
  const periods = vacaciones?.rows || [];
  const months = useMemo(() => {
    const byMonth = new Map();
    periods.forEach((period) => {
      const start = parsePortalDate(period.inicio);
      const end = parsePortalDate(period.fin);
      if (!start || !end) return;
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      const finalMonth = new Date(end.getFullYear(), end.getMonth(), 1);
      while (cursor <= finalMonth) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
        if (!byMonth.has(key)) byMonth.set(key, { key, year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    });
    const today = new Date();
    if (Number(vacaciones?.year) === today.getFullYear()
      || [...byMonth.values()].some((month) => month.year === today.getFullYear())) {
      const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
      if (!byMonth.has(key)) byMonth.set(key, { key, year: today.getFullYear(), month: today.getMonth() + 1 });
    }
    return [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [periods, vacaciones?.year]);
  const [selectedMonthKey, setSelectedMonthKey] = useState("");

  useEffect(() => {
    if (months.length && !months.some((month) => month.key === selectedMonthKey)) {
      const now = new Date();
      const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      setSelectedMonthKey(months.find((month) => month.key === currentKey)?.key || months[0].key);
    }
  }, [months, selectedMonthKey]);

  if (!vacaciones?.recognized || periods.length === 0 || months.length === 0) return null;
  const accumulatedDays = Math.max(
    Number(vacaciones.totalDays) || 0,
    ...periods.map((period) => Number(period.acumulado) || 0)
  );
  const selectedMonth = months.find((month) => month.key === selectedMonthKey) || months[0];
  const totalDaysInMonth = new Date(selectedMonth.year, selectedMonth.month, 0).getDate();
  const firstDay = new Date(selectedMonth.year, selectedMonth.month - 1, 1).getDay();
  const leadingBlanks = (firstDay + 6) % 7;
  const vacationDays = new Set();
  const today = new Date();
  periods.forEach((period) => {
    const start = parsePortalDate(period.inicio);
    const end = parsePortalDate(period.fin);
    if (!start || !end) return;
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      if (cursor.getFullYear() === selectedMonth.year && cursor.getMonth() + 1 === selectedMonth.month) {
        vacationDays.add(cursor.getDate());
      }
    }
  });

  return (
    <section className="portal-vacation-card">
      <div className="portal-vacation-heading">
        <div className="portal-vacation-icon"><CalendarDays size={22} /></div>
        <div>
          <p>Vacaciones {vacaciones.year || ""}</p>
          <h1>{accumulatedDays} dias asignados</h1>
        </div>
        <strong>{periods.length} {periods.length === 1 ? "periodo" : "periodos"}</strong>
      </div>
      <div className="portal-vacation-month-tabs">
        {months.map((month) => (
          <button className={month.key === selectedMonth.key ? "is-active" : ""} type="button" key={month.key} onClick={() => setSelectedMonthKey(month.key)}>
            {MONTHS_ES[month.month - 1]} {month.year}
          </button>
        ))}
      </div>
      <div className="portal-vacation-calendar">
        {["L", "M", "X", "J", "V", "S", "D"].map((day) => <span className="portal-vacation-weekday" key={day}>{day}</span>)}
        {Array.from({ length: leadingBlanks }, (_, index) => <i key={`blank-${index}`} />)}
        {Array.from({ length: totalDaysInMonth }, (_, index) => {
          const day = index + 1;
          const isVacation = vacationDays.has(day);
          const dateKey = `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const canSelect = Boolean(onDaySelect) && new Date(selectedMonth.year, selectedMonth.month - 1, day)
            >= new Date(today.getFullYear(), today.getMonth(), today.getDate());
          const isToday = selectedMonth.year === today.getFullYear() && selectedMonth.month === today.getMonth() + 1 && day === today.getDate();
          const DayTag = canSelect ? "button" : "span";
          return <DayTag type={canSelect ? "button" : undefined}
            className={`${isVacation ? "is-vacation" : ""}${isToday ? " is-today" : ""}${selectedDay?.dateKey === dateKey ? " is-selected" : ""}`}
            key={day}
            aria-current={isToday ? "date" : undefined}
            onClick={canSelect ? () => onDaySelect({ dateKey, isVacation }) : undefined}
            aria-label={canSelect ? `${day} de ${MONTHS_ES[selectedMonth.month - 1]}: ${isVacation ? "vacaciones asignadas; ofrecer este día" : "quiero vacaciones este día"}` : undefined}>
            {day}{isVacation && <small>VA</small>}
          </DayTag>;
        })}
      </div>
      <div className="portal-vacation-periods compact">
        {periods.map((period, index) => {
          return (
            <article key={`${period.inicio}-${period.fin}-${index}`}>
              <div>
                <strong>{formatVacationRange(period)}</strong>
                <span>{period.dias} {Number(period.dias) === 1 ? "dia" : "dias"}</span>
              </div>
            </article>
          );
        })}
      </div>
      <a className="portal-official-action" href="https://portal.cpevalencia.com/#User,ViewNoray,16" target="_blank" rel="noreferrer">
        Abrir intercambio de vacaciones en el Portal <ExternalLink size={15} />
      </a>
    </section>
  );
}


function PortalCalendarPreview({ descansos, vacaciones, slRows = [], vacationEntries = [], onDaySelect, selectedDay }) {
  const months = useMemo(() => buildPersonalRestMonths(descansos, vacaciones), [descansos, vacaciones]);
  const vacationDates = useMemo(() => new Set(
    vacationEntries.map((item) => String(item?.payroll?.date || "")).filter(Boolean)
  ), [vacationEntries]);
  const slPositionByDate = useMemo(() => {
    const positions = new Map();
    slRows.forEach((item) => {
      const match = String(item.fecha || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!match) return;
      positions.set(`${match[3]}-${match[2]}-${match[1]}`, String(item.posicion || "").trim());
    });
    return positions;
  }, [slRows]);
  const defaultMonthIndex = useMemo(() => {
    const now = new Date();
    const currentIndex = months.findIndex((item) => Number(item.month) === now.getMonth() + 1 && Number(item.year) === now.getFullYear());
    return currentIndex < 0 ? Math.max(0, months.findIndex((item) => item.key > `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`)) : currentIndex;
  }, [months]);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState(defaultMonthIndex);

  useEffect(() => {
    setSelectedMonthIndex(defaultMonthIndex);
  }, [defaultMonthIndex]);

  const month = months[selectedMonthIndex] || months[defaultMonthIndex] || months[0];
  if (!month) return null;
  const days = month.days;
  const today = new Date();
  const isCurrentMonth = Number(month.month) === today.getMonth() + 1 && Number(month.year) === today.getFullYear();

  return (
    <section className="portal-calendar-card">
      <div className="section-title-row compact">
        <div>
          <p>Calendario</p>
          <h1>{MONTHS_ES[month.month - 1]} {month.year}</h1>
        </div>
      </div>
      {months.length > 1 && <div className="personal-rest-navigation">
        <button type="button" disabled={selectedMonthIndex === 0} onClick={() => setSelectedMonthIndex((index) => index - 1)} aria-label="Mes anterior">‹</button>
        <select aria-label="Mes del calendario de descansos" value={month.key} onChange={(event) => setSelectedMonthIndex(months.findIndex((item) => item.key === event.target.value))}>
          {months.map((item) => <option key={item.key} value={item.key}>{MONTHS_ES[item.month - 1]} {item.year}</option>)}
        </select>
        <button type="button" disabled={selectedMonthIndex === months.length - 1} onClick={() => setSelectedMonthIndex((index) => index + 1)} aria-label="Mes siguiente">›</button>
      </div>}
      <div className="portal-calendar-grid">
        {["L", "M", "X", "J", "V", "S", "D"].map((weekday) => (
          <div className="portal-weekday" key={weekday}>{weekday}</div>
        ))}
        {days.map((item) => {
          const day = item.day;
          const code = item.code || "";
          const date = new Date(Number(month.year), Number(month.month) - 1, day);
          const dateKey = `${month.year}-${String(month.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isVacation = item.vacation || vacationDates.has(dateKey) || code === "VA";
          const displayCode = isVacation ? "VA" : code;
          const slPosition = code.toUpperCase() === "SL" && !isVacation ? slPositionByDate.get(dateKey) : "";
          const gridColumn = day === 1 ? ((date.getDay() + 6) % 7) + 1 : undefined;
          const isToday = isCurrentMonth && day === today.getDate();
          const DayTag = onDaySelect ? "button" : "div";
          return (
            <DayTag
              type={onDaySelect ? "button" : undefined}
              key={day}
              className={`portal-day personal-rest-day is-${isVacation ? "vacation" : item.type || "ordinary"} ${isVacation ? "has-vacation" : ""} ${isToday ? "is-today" : ""} ${selectedDay?.dateKey === dateKey ? "is-selected" : ""}`}
              aria-current={isToday ? "date" : undefined}
              style={gridColumn ? { gridColumnStart: gridColumn } : undefined}
              onClick={onDaySelect ? () => onDaySelect({ dateKey, code: displayCode, source: month.source }) : undefined}
              aria-label={onDaySelect ? `${day} de ${MONTHS_ES[month.month - 1]}: ${displayCode || ({ rest: "descanso", week: "descanso", holiday: "festivo inhábil", requested: "lista de espera" }[item.type] || "día laborable")}. Ver opciones de intercambio` : undefined}
            >
              <span>{day}</span>
              <small>{WEEKDAYS_ES[date.getDay()]}</small>
              {(displayCode || item.type || isVacation) && (
                <strong
                  className={slPosition ? "portal-day-sl-position" : undefined}
                  title={slPosition ? `Posicion SL ${slPosition}` : undefined}
                >
                  {slPosition ? `${displayCode} · ${slPosition}` : displayCode || ({ rest: "DS", week: "DS", holiday: "FH", requested: "SL" }[item.type] || "")}
                </strong>
              )}
            </DayTag>
          );
        })}
      </div>
      <div className="personal-rest-legend"><span><i className="is-rest" /> DS · Descanso</span><span><i className="is-festive" /> FS · Festivo</span><span><i className="is-training" /> FM · Formación</span><span><i className="is-requested" /> SL · Solicitado</span><span><i className="is-holiday" /> Festivo inhábil</span><span><i className="has-vacation" /> Vacaciones asignadas</span></div>
      <a className="portal-official-action" href={annualRestCalendarUrl} target="_blank" rel="noreferrer">
        Abrir Calendario Anual <ExternalLink size={15} />
      </a>
      <a className="portal-official-action" href={PORTAL_HOME_URL} target="_blank" rel="noreferrer">
        Gestionar descansos en el Portal <ExternalLink size={15} />
      </a>
    </section>
  );
}


function BottomNav({ activeTab, onChange }) {
  return (
    <nav className="bottom-nav" aria-label="Navegacion inferior">
      {BOTTOM_NAV_ITEMS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={activeTab === id ? "active" : ""}
          onClick={() => onChange(id)}
          aria-current={activeTab === id ? "page" : undefined}
        >
          <Icon size={23} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function ContactFooter({ login = false }) {
  return (
    <footer className={`contact-footer${login ? " login-contact-footer" : ""}`}>
      <span>Dudas o sugerencias:</span>
      <a href="mailto:portalestibavlc@gmail.com">portalestibavlc@gmail.com</a>
    </footer>
  );
}


export { AppHeader, BottomNav, ContactFooter, PortalCalendarPreview, PortalVacationPreview };

