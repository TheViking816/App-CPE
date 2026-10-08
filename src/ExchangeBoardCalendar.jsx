import { useMemo, useState } from "react";
import { madridTodayKey } from "./exchangeDeadline.js";
import { dateRangeKeys } from "./vacationExchange.js";

const LABELS = { swap: "Intercambio", give: "Cesión", want: "Busco descanso" };
const dayKey = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export default function ExchangeBoardCalendar({ offers = [], selectedDate = "", onSelectDate, vacation = false }) {
  const [visibleMonth, setVisibleMonth] = useState(() => madridTodayKey().slice(0, 7));
  const [year, month] = visibleMonth.split("-").map(Number);
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const count = new Date(year, month, 0).getDate();
  const entries = useMemo(() => {
    const byDay = new Map();
    for (const offer of offers) {
      const dates = vacation
        ? [...dateRangeKeys(offer.offeredStart, offer.offeredEnd).map((date) => [date, 'offered']), ...dateRangeKeys(offer.wantedStart, offer.wantedEnd).map((date) => [date, 'wanted'])]
        : [[offer.offeredDate, offer.kind], [offer.wantedDate, offer.kind]];
      for (const [date, kind] of dates) {
        if (!date) continue;
        const rows = byDay.get(date) || [];
        if (!rows.some((row) => row.id === offer.id && row.kind === kind)) rows.push({ id: offer.id, kind });
        byDay.set(date, rows);
      }
    }
    return byDay;
  }, [offers, vacation]);
  const changeMonth = (offset) => {
    const date = new Date(year, month - 1 + offset, 1);
    setVisibleMonth(dayKey(date.getFullYear(), date.getMonth() + 1, 1).slice(0, 7));
  };
  return <section className="exchange-board-calendar" aria-label={`Calendario de ofertas de ${vacation ? 'vacaciones' : 'descansos'}`}>
    <header><div><small>Tablón de ofertas</small><h3>{new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1))}</h3></div>
      <div><button type="button" aria-label="Mes anterior" onClick={() => changeMonth(-1)}>‹</button><button type="button" aria-label="Mes siguiente" onClick={() => changeMonth(1)}>›</button></div>
    </header>
    <div className="exchange-board-legend">{Object.entries(vacation ? { offered: 'Ofrece vacaciones', wanted: 'Busca vacaciones' } : LABELS).map(([kind, label]) => <span key={kind} className={`is-${kind}`}>{label}</span>)}</div>
    <div className="exchange-board-grid">{["L", "M", "X", "J", "V", "S", "D"].map((label, index) => <strong key={index} className="weekday">{label}</strong>)}
      {Array.from({ length: firstWeekday }, (_, index) => <span className="blank" key={`blank-${index}`} />)}
      {Array.from({ length: count }, (_, index) => {
        const date = dayKey(year, month, index + 1);
        const dayOffers = entries.get(date) || [];
        return <button type="button" key={date} className={`${dayOffers.length ? "has-offers" : ""}${selectedDate === date ? " is-selected" : ""}`}
          onClick={() => onSelectDate(selectedDate === date ? "" : date)}
          aria-label={`${index + 1} de ${new Intl.DateTimeFormat("es-ES", { month: "long" }).format(new Date(year, month - 1, 1))}: ${new Set(dayOffers.map((offer) => offer.id)).size} ofertas`}>
          <span>{index + 1}</span><span className="offer-dots">{[...new Set(dayOffers.map((offer) => offer.kind))].map((kind) => <i key={kind} className={`is-${kind}`} />)}</span>
        </button>;
      })}
    </div>
    {selectedDate && <button className="exchange-calendar-clear" type="button" onClick={() => onSelectDate("")}>Ver todas las ofertas</button>}
    {!offers.length && <p>El calendario se irá llenando cuando se publiquen ofertas.</p>}
  </section>;
}
