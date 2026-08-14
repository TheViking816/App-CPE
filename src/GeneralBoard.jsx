import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, Search, Ship, UsersRound } from "lucide-react";
import { boardCounts, companyLogo, dateLabel, defaultJourneyKey, fetchGeneralBoard, groupImage, normalizeText, sortGroups, sortSpecialties } from "./generalBoard.js";

function sourceCounts(group) {
  return [...group.specialties.values()].reduce((sum, item) => ({ bolsa: sum.bolsa + item.bolsa.length, turno: sum.turno + item.turno }), { bolsa: 0, turno: 0 });
}

function Specialty({ specialty }) {
  const total = specialty.turno + specialty.bolsa.length;
  return (
    <div className="general-specialty">
      <div className="general-specialty-title"><strong>{specialty.name}</strong><span>{total}</span></div>
      <div className="general-workers">
        {specialty.turno > 0 && <span className="worker-chip turno">Turno {specialty.turno}</span>}
        {specialty.bolsa.map((item, index) => <span className="worker-chip bolsa" key={`${item.id || item.chapa}-${index}`}>{item.chapa || "S/N"}</span>)}
      </div>
    </div>
  );
}

function Operation({ companyKey, group, journey, expandAll }) {
  const [open, setOpen] = useState(false);
  const counts = sourceCounts(group);
  const total = counts.turno + counts.bolsa;
  const image = groupImage(group);
  const expanded = expandAll || open;
  return (
    <article className={`general-operation ${expanded ? "expanded" : ""}`}>
      <button type="button" className="general-operation-head" onClick={() => setOpen((value) => !value)}>
        <Ship size={20} />
        <span><strong>{group.name}</strong><small>{group.operacion || (group.hasShip ? "CONT. C/SPREADER AUT" : group.muelle || "Operación portuaria")}</small></span>
        <span className="source-count turno">{counts.turno}</span><span className="source-count bolsa">{counts.bolsa}</span><b>{total}</b>
        <ChevronDown size={20} />
      </button>
      {expanded && <div className="general-operation-body">
        {image && <img className="general-operation-image" src={image} alt={group.name} onError={(event) => { event.currentTarget.style.display = "none"; }} />}
        <div className="general-operation-meta"><strong>{group.name}</strong><span>{group.muelle && group.muelle !== "-" ? `Muelle · ${group.muelle}` : `Jornada ${journey.jornada}`}</span></div>
        <div className="general-specialties">{sortSpecialties(group.specialties.values()).map((item) => <Specialty specialty={item} key={`${companyKey}-${group.key}-${item.key}`} />)}</div>
      </div>}
    </article>
  );
}

function Company({ company, journey, query, expandAll }) {
  const [open, setOpen] = useState(false);
  const logo = companyLogo(company.name);
  const groups = useMemo(() => sortGroups(company.groups.values()).filter((group) => {
    if (!query) return true;
    return normalizeText([company.name, group.name, group.operacion, group.muelle, ...[...group.specialties.values()].flatMap((item) => [item.name, ...item.bolsa.map((worker) => worker.chapa)])].join(" ")).toUpperCase().includes(query);
  }), [company, query]);
  if (!groups.length) return null;
  const counts = groups.reduce((sum, group) => { const current = sourceCounts(group); return { turno: sum.turno + current.turno, bolsa: sum.bolsa + current.bolsa }; }, { turno: 0, bolsa: 0 });
  const expanded = expandAll || open;
  return (
    <section className={`general-company ${expanded ? "expanded" : ""}`}>
      <button type="button" className="general-company-head" onClick={() => setOpen((value) => !value)}>
        <span className="company-logo">{logo ? <img src={logo} alt="" /> : <Building2 size={24} />}</span>
        <span><strong>{company.name}</strong><small>{counts.turno + counts.bolsa} asignaciones en {groups.length} operaciones</small></span>
        <span className="source-count turno">{counts.turno}</span><span className="source-count bolsa">{counts.bolsa}</span><ChevronDown size={22} />
      </button>
      {expanded && <div className="general-company-body">{groups.map((group) => <Operation companyKey={company.key} group={group} journey={journey} expandAll={expandAll} key={group.key} />)}</div>}
    </section>
  );
}

export default function GeneralBoard({ chapa, onOpen }) {
  const [data, setData] = useState({ journeys: [], updatedAt: "", expectedKey: "", bolsaPending: false });
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [expandAll, setExpandAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    onOpen?.(chapa);
    fetchGeneralBoard().then((result) => {
      if (!active) return;
      setData(result);
      setSelected(defaultJourneyKey(result.journeys));
    }).catch(() => active && setError("No se pudo cargar la contratación general."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [chapa]);

  const journey = data.journeys.find((item) => item.key === selected);
  const counts = boardCounts(journey);
  const normalizedQuery = normalizeText(query).toUpperCase();
  return (
    <section className="general-board page-panel">
      <div className="section-heading"><p>Contratación completa</p><h1>Tablón general</h1></div>
      {loading && <div className="general-loading"><span className="spinner" />Cargando contratación...</div>}
      {error && <p className="inline-notice error">{error}</p>}
      {!loading && !error && !journey && <p className="inline-notice">Contratación pendiente. Esperando la jornada correspondiente a este horario.</p>}
      {!loading && journey && <>
        <div className="general-journeys">{data.journeys.map((item) => { const itemCounts = boardCounts(item); return <button type="button" className={item.key === journey.key ? "active" : ""} onClick={() => { setSelected(item.key); setExpandAll(false); }} key={item.key}>{item.anticipada && <i className="journey-status-badge">Anticipada</i>}<strong>{item.jornada}</strong><span>{dateLabel(item.fecha)}</span><small>{itemCounts.total} asignaciones</small><em><b className="bolsa">B {itemCounts.bolsa}</b><b className="turno">T {itemCounts.turno}</b></em></button>; })}</div>
        <div className="general-tools"><label><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar asignaciones..." /></label><button type="button" onClick={() => setExpandAll((value) => !value)}>{expandAll ? "Contraer" : "Expandir"}</button></div>
        <div className="general-summary"><div><UsersRound size={24} /><span>Contratación total<strong>{counts.total}</strong><small>{counts.companies} empresas · {counts.ships} barcos</small></span></div><p className="turno"><span>Turno</span><strong>{counts.turno}</strong></p><p className="bolsa"><span>Bolsa</span><strong>{data.bolsaPending && journey.key === data.expectedKey ? "Pendiente" : counts.bolsa}</strong></p></div>
        <div className="general-company-list">{[...journey.companies.values()].map((company) => <Company company={company} journey={journey} query={normalizedQuery} expandAll={expandAll} key={company.key} />)}</div>
        <p className="general-updated">Actualizado {data.updatedAt ? new Date(data.updatedAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "--"}</p>
      </>}
    </section>
  );
}
