import { useMemo, useState } from "react";
import { madridTodayKey } from "./exchangeDeadline.js";
import { dateRangeKeys } from "./vacationExchange.js";
import { availableRestMonths, parseRestGroup } from "./companyRestCalendar.js";
import { personalRestMarks, personalVacationMarks } from "./personalRestCalendar.js";

const LABELS = { swap: "Intercambio", give: "Cesión", want: "Busco descanso" };
const dayKey = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const monthName = (year, month) => new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));

export default function ExchangeBoardCalendar({ offers = [], selectedDate = "", onSelectDate, vacation = false, restGroup = "", overrides = [], paidDays = [], onEditDate }) {
  const todayKey = madridTodayKey();
  const [visibleMonth, setVisibleMonth] = useState(() => todayKey.slice(0, 7));
  const group = parseRestGroup(restGroup);
  const [selectedYear, selectedMonth] = visibleMonth.split("-").map(Number);
  const months = [[selectedYear, selectedMonth]];
  const restMonths = availableRestMonths(selectedYear);
  const entries = useMemo(() => {
    const byDay = new Map();
    for (const offer of offers) {
      const dates = vacation
        ? [...dateRangeKeys(offer.offeredStart, offer.offeredEnd).map((date) => [date, "offered"]), ...dateRangeKeys(offer.wantedStart, offer.wantedEnd).map((date) => [date, "wanted"])]
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
    const date = new Date(selectedYear, selectedMonth - 1 + offset, 1);
    if (!vacation && todayKey.startsWith("2026-") && date.getFullYear() !== 2026) return;
    setVisibleMonth(dayKey(date.getFullYear(), date.getMonth() + 1, 1).slice(0, 7));
  };
  const restCalendarAvailable = !vacation && restMonths.includes(selectedMonth);
  return <section className="exchange-board-calendar" aria-label={`Calendario de ofertas de ${vacation ? "vacaciones" : "descansos"}`}>
    <header><div><small>{vacation ? "Tablón de ofertas" : group ? `Descansos del grupo ${group.label} · Ofertas` : "Descansos y ofertas"}</small>
      <h3>{monthName(selectedYear, selectedMonth)}</h3></div>
      <div><button type="button" aria-label="Mes anterior" disabled={!vacation && todayKey.startsWith("2026-") && selectedYear === 2026 && selectedMonth === 1} onClick={() => changeMonth(-1)}>‹</button><button type="button" aria-label="Mes siguiente" disabled={!vacation && todayKey.startsWith("2026-") && selectedYear === 2026 && selectedMonth === 12} onClick={() => changeMonth(1)}>›</button></div>
    </header>
    {!vacation && !group && <p className="exchange-rest-group-notice">Elige tu grupo de descansos en <a href="#/perfil">Mis datos</a> para ver tus descansos de todo el año.</p>}
    {!vacation && group && !restCalendarAvailable && <p className="exchange-rest-group-notice">El calendario laboral de este año aún no está disponible. Consulta tus descansos en el portal oficial.</p>}
    <div className="exchange-board-legend">{Object.entries(vacation ? { offered: "Ofrece vacaciones", wanted: "Busca vacaciones" } : LABELS).map(([kind, label]) => <span key={kind} className={`is-${kind}`}>{label}</span>)}{vacation && <><span className="is-personal-vacation">Mis vacaciones · VA</span><span className="is-personal-training">Mi formación · FM</span></>}</div>
    {!vacation && <div className="exchange-rest-legend" aria-label="Colores del calendario personal">
      {restCalendarAvailable && group && <><span className={`is-rest-${group.letter}`}>Grupo {group.letter.toUpperCase()}</span><span className={`is-week-${group.week}`}>Semana {group.week.toUpperCase()}</span><span className="is-holiday">Festivo inhábil</span></>}
      <span className="is-manual-rest">DS manual</span><span className="is-chosen-holiday">FS</span><span className="is-training">FM</span><span className="is-vacation">VA</span>
    </div>}
    <div className={`exchange-board-months${vacation ? " is-single" : ""}`}>
      {months.map(([year, month]) => {
        const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
        const count = new Date(year, month, 0).getDate();
        return <div className="exchange-board-month" key={`${year}-${month}`}>
          {months.length > 1 && <h4>{monthName(year, month)}</h4>}
          <div className="exchange-board-grid">{["L", "M", "X", "J", "V", "S", "D"].map((label, index) => <strong key={index} className="weekday">{label}</strong>)}
            {Array.from({ length: firstWeekday }, (_, index) => <span className="blank" key={`blank-${index}`} />)}
            {Array.from({ length: count }, (_, index) => {
              const date = dayKey(year, month, index + 1);
              const dayOffers = entries.get(date) || [];
              const marks = vacation ? personalVacationMarks(date, paidDays)
                : personalRestMarks(date, group, overrides, paidDays);
              const restType = marks[0]?.type || "";
              const restLabel = marks.map((mark) => mark.label).join(" y ");
              return <button type="button" key={date} className={`${dayOffers.length ? "has-offers" : ""}${selectedDate === date ? " is-selected" : ""}${restType ? ` is-${restType}` : ""}`}
                onClick={() => dayOffers.length || !onEditDate ? onSelectDate(date) : onEditDate(date)}
                aria-label={`${index + 1} de ${monthName(year, month)}${restLabel ? `, ${restLabel}` : ""}: ${new Set(dayOffers.map((offer) => offer.id)).size} ofertas${onEditDate && !dayOffers.length ? ", editar día" : ""}`}>
                <span>{index + 1}</span><span className="rest-day-marks">{marks.map((mark) => <b key={mark.type} className={`is-${mark.type}`}>{mark.label}</b>)}</span>
                <span className="offer-dots">{[...new Set(dayOffers.map((offer) => offer.kind))].map((kind) => <i key={kind} className={`is-${kind}`} />)}</span>
              </button>;
            })}
          </div>
        </div>;
      })}
    </div>
    {selectedDate && <button className="exchange-calendar-clear" type="button" onClick={() => onSelectDate("")}>Ver todas las ofertas</button>}
    {!offers.length && <p>El calendario se irá llenando cuando se publiquen ofertas.</p>}
  </section>;
}
