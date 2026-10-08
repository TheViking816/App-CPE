import { useState } from "react";

const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function filterExchangeOffers(offers, filters, vacation = false) {
  return offers.filter(offer => {
    const text = normalize([offer.ownerName, offer.ownerChapa].join(" "));
    const group = vacation ? offer.professionalGroup : offer.ownerGroup;
    return (!filters.search || text.includes(normalize(filters.search.trim())))
      && (!filters.group || group === filters.group)
      && (!filters.kind || offer.kind === filters.kind)
      && (!filters.date || (vacation
        ? (offer.offeredStart <= filters.date && offer.offeredEnd >= filters.date) || (offer.wantedStart <= filters.date && offer.wantedEnd >= filters.date)
        : offer.offeredDate === filters.date || offer.wantedDate === filters.date));
  });
}
export function useExchangeFilters(offers, vacation = false) {
  const [filters, setFilters] = useState({ search: "", group: "", kind: "", date: "" });
  return { filters, setFilters, visible: filterExchangeOffers(offers, filters, vacation) };
}
export default function ExchangeFilters({ offers, filters, setFilters, count, vacation = false }) {
  const groups = [...new Set(offers.map(o => vacation ? o.professionalGroup : o.ownerGroup).filter(Boolean))].sort((a,b) => a.localeCompare(b, "es"));
  const set = (key, value) => setFilters(previous => ({ ...previous, [key]: value }));
  const active = Object.values(filters).some(Boolean);
  return <div className="exchange-filters">
    <div className="exchange-filter-fields">
      <label>Buscar<input type="search" placeholder="Nombre o chapa" value={filters.search} onChange={e => set("search", e.target.value)}/></label>
      {!vacation && <label>Tipo<select value={filters.kind} onChange={e => set("kind", e.target.value)}><option value="">Todos los tipos</option><option value="swap">Intercambios</option><option value="give">Cesiones</option><option value="want">Busco descanso</option></select></label>}
      <label>{vacation ? "Grupo profesional" : "Grupo de descanso"}<select value={filters.group} onChange={e => set("group", e.target.value)}><option value="">Todos los grupos</option>{groups.map(group => <option key={group} value={group}>{group}</option>)}</select></label>
      <label>Fecha ofrecida o buscada<input type="date" value={filters.date} onChange={e => set("date", e.target.value)}/></label>
    </div>
    <div className="exchange-filter-summary"><span role="status">{count} de {offers.length} ofertas</span>{active && <button type="button" onClick={() => setFilters({ search: "", group: "", kind: "", date: "" })}>Limpiar filtros</button>}</div>
  </div>;
}
