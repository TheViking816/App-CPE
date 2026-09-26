import { ArrowLeftRight, LayoutGrid, Plus, UserRound, Sun } from "lucide-react";

// Presentation only: these components do not read data or perform mutations.
export function ExchangeDate({ start, end }) {
  const first = new Date(`${start}T12:00:00`);
  const last = end && end !== start ? new Date(`${end}T12:00:00`) : null;
  const month = (date) => new Intl.DateTimeFormat("es-ES", { month: "short" }).format(date).replace(".", "");
  return <span className="exchange-date-display">
    <time dateTime={start}>{first.getDate()}{last && <><em>—</em>{last.getDate()}</>}</time>
    <span>{last && last.getFullYear() !== first.getFullYear()
      ? `${month(first)} ${first.getFullYear()} – ${month(last)} ${last.getFullYear()}`
      : `${month(first)}${last && last.getMonth() !== first.getMonth() ? ` – ${month(last)}` : ""} ${first.getFullYear()}`}</span>
    <small>{last ? "Periodo de vacaciones" : new Intl.DateTimeFormat("es-ES", { weekday: "long" }).format(first)}</small>
  </span>;
}

export function ExchangeHeroIcon({ vacation = false }) {
  return <span className="exchange-hero-icon" aria-hidden="true">{vacation ? <Sun size={27} /> : <ArrowLeftRight size={27} />}</span>;
}

export function ExchangeTabIcon({ tab }) {
  const Icon = tab === "board" ? LayoutGrid : tab === "publish" ? Plus : UserRound;
  return <Icon size={17} aria-hidden="true" />;
}

export function ExchangeAvatar({ name }) {
  return <span className="exchange-avatar" aria-hidden="true">{String(name || "C").trim().slice(0, 1).toUpperCase()}</span>;
}
