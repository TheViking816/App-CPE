import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canRespondToRestOffer, confirmedRestExchangeDays } from "./restExchange.js";
import {
  cancelRestExchange,
  decideRestExchange,
  getRestExchange,
  proposeRestExchange,
  publishRestExchange,
  withdrawRestExchange
} from "./supabaseClient.js";

const KINDS = {
  swap: "Intercambio",
  give: "Cesión",
  want: "Busco descanso"
};

function formatDay(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(year, month - 1, day));
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function RestExchangePanel({ session, descansos, vacaciones, vacationEntries = [], selectedDay }) {
  const [tab, setTab] = useState("board");
  const [kind, setKind] = useState("swap");
  const [offeredDate, setOfferedDate] = useState("");
  const [wantedDate, setWantedDate] = useState("");
  const [data, setData] = useState({ offers: [], proposals: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const panelRef = useRef(null);
  const days = useMemo(() => confirmedRestExchangeDays(descansos, vacaciones, vacationEntries),
    [descansos, vacaciones, vacationEntries]);
  const restDates = useMemo(() => new Set(days.rest.map((item) => item.date)), [days.rest]);
  const workDates = useMemo(() => new Set(days.work.map((item) => item.date)), [days.work]);

  const reload = useCallback(async ({ quiet = false } = {}) => {
    if (!session?.token) return;
    if (!quiet) setLoading(true);
    try {
      setData(await getRestExchange({ token: session.token }));
      setError("");
    } catch (loadError) {
      setError(loadError.message || "No se pudo cargar el tablón.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [session?.token]);

  useEffect(() => {
    reload();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") reload({ quiet: true });
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    if (!selectedDay) return;
    setError("");
    setNotice("");
    setTab("publish");
    if (restDates.has(selectedDay.dateKey)) {
      setKind("swap");
      setOfferedDate(selectedDay.dateKey);
    } else if (workDates.has(selectedDay.dateKey)) {
      setKind("want");
      setWantedDate(selectedDay.dateKey);
    }
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedDay]);

  async function mutate(action, successMessage) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await reload({ quiet: true });
    } catch (actionError) {
      setError(actionError.message || "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  }

  function publish(event) {
    event.preventDefault();
    const giving = kind !== "want" ? offeredDate : null;
    const needing = kind !== "give" ? wantedDate : null;
    if (giving && !restDates.has(giving)) return setError("Elige un DS o FS confirmado en tu portal.");
    if (needing && !workDates.has(needing)) return setError("Elige un día laborable visible en tu portal.");
    if ((kind === "swap" && (!giving || !needing || giving === needing))
      || (kind === "give" && !giving) || (kind === "want" && !needing)) {
      return setError("Selecciona los días correspondientes.");
    }
    return mutate(
      () => publishRestExchange({ token: session.token, kind, offeredDate: giving, wantedDate: needing }),
      "Publicación visible en el tablón. El descanso oficial aún no cambia."
    );
  }

  const offers = data.offers || [];
  const today = todayKey();
  const board = offers.filter((offer) => offer.status === "open"
    && (!offer.offeredDate || offer.offeredDate >= today)
    && (!offer.wantedDate || offer.wantedDate >= today));
  const mine = offers.filter((offer) => offer.isOwn || (data.proposals || []).some((proposal) => proposal.offerId === offer.id && proposal.isOwn));
  const proposalsByOffer = (offerId) => (data.proposals || []).filter((proposal) => proposal.offerId === offerId);

  function offerCard(offer, personal = false) {
    const proposals = proposalsByOffer(offer.id);
    const myProposal = proposals.find((proposal) => proposal.isOwn && ["pending", "accepted"].includes(proposal.status));
    const canRespond = canRespondToRestOffer(offer, restDates, workDates);
    return <article className="rest-exchange-offer" key={offer.id}>
      <div className="rest-exchange-offer-head">
        <div><span>{KINDS[offer.kind]}</span><strong>{offer.ownerName || "Compañero"}</strong></div>
        <small>{offer.ownerGroup ? `Grupo ${offer.ownerGroup}` : "Grupo no disponible"}</small>
      </div>
      <div className="rest-exchange-dates">
        {offer.offeredDate && <div><small>Ofrece</small><strong>{formatDay(offer.offeredDate)}</strong></div>}
        {offer.wantedDate && <div><small>Busca</small><strong>{formatDay(offer.wantedDate)}</strong></div>}
      </div>
      {personal && <span className="rest-exchange-status">{offer.status === "agreed" ? "Acordado · pendiente de tramitar en el portal" : offer.status === "cancelled" ? "Retirado" : "Abierto"}</span>}
      {offer.status === "open" && !offer.isOwn && !myProposal && <div className="rest-exchange-actions">
        <button type="button" disabled={busy || !canRespond} onClick={() => mutate(
          () => proposeRestExchange({ token: session.token, offerId: offer.id,
            offeredDate: offer.kind === "give" ? null : offer.wantedDate }),
          "Propuesta enviada. El autor recibirá una notificación."
        )}>Me interesa</button>
        {!canRespond && <small>{offer.offeredDate && !workDates.has(offer.offeredDate)
          ? "Ese día no figura como laborable para ti en el portal."
          : "No tienes el día solicitado como DS o FS confirmado."}</small>}
      </div>}
      {offer.isOwn && offer.status === "open" && <button type="button" className="rest-exchange-secondary" disabled={busy}
        onClick={() => mutate(() => cancelRestExchange({ token: session.token, offerId: offer.id }), "Publicación retirada.")}>Retirar publicación</button>}
      {myProposal?.status === "pending" && <button type="button" className="rest-exchange-secondary" disabled={busy}
        onClick={() => mutate(() => withdrawRestExchange({ token: session.token, proposalId: myProposal.id }), "Propuesta retirada.")}>Retirar mi propuesta</button>}
      {personal && proposals.filter((proposal) => proposal.status === "pending" && !proposal.isOwn).map((proposal) => <div className="rest-exchange-proposal" key={proposal.id}>
        <span>{proposal.proposerName} {proposal.offeredDate ? `ofrece ${formatDay(proposal.offeredDate)}` : "solicita la cesión"}</span>
        <div><button type="button" disabled={busy} onClick={() => mutate(
          () => decideRestExchange({ token: session.token, proposalId: proposal.id, accept: true }),
          "Acuerdo registrado. Ambos debéis tramitarlo en el portal oficial."
        )}>Aceptar</button><button type="button" className="rest-exchange-secondary" disabled={busy} onClick={() => mutate(
          () => decideRestExchange({ token: session.token, proposalId: proposal.id, accept: false }),
          "Propuesta rechazada."
        )}>Rechazar</button></div>
      </div>)}
      {personal && proposals.filter((proposal) => proposal.status === "accepted").map((proposal) => <div className="rest-exchange-agreement" key={proposal.id}>
        <strong>Acuerdo con chapa {proposal.counterpartChapa}</strong>
        <span>Tramitad el intercambio o la cesión en el Portal CPE. Esta app no modifica los descansos oficiales.</span>
        <a href="https://portal.cpevalencia.com/#User" target="_blank" rel="noreferrer">Abrir portal oficial ↗</a>
      </div>)}
    </article>;
  }

  return <section className="rest-exchange-panel" ref={panelRef}>
    <div className="rest-exchange-heading"><div><p>Entre compañeros</p><h2>Intercambios y cesiones</h2></div></div>
    <p className="rest-exchange-intro">Publica un DS o FS, busca el día que necesitas y acordadlo aquí. El cambio solo será efectivo cuando lo tramitéis en el portal oficial.</p>
    <div className="rest-exchange-tabs" role="tablist" aria-label="Intercambios de descansos">
      {[["board", "Tablón"], ["publish", "Publicar"], ["mine", "Mis gestiones"]].map(([value, label]) =>
        <button type="button" role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} key={value} onClick={() => setTab(value)}>{label}</button>)}
    </div>
    {error && <p className="rest-exchange-error" role="alert">{error}</p>}
    {notice && <p className="rest-exchange-notice" role="status">{notice}</p>}
    {tab === "publish" && <form className="rest-exchange-form" onSubmit={publish}>
      {selectedDay && !restDates.has(selectedDay.dateKey) && !workDates.has(selectedDay.dateKey) &&
        <p className="rest-exchange-note">El día seleccionado aún no consta como DS, FS o laborable confirmado en el portal. Elige otro día de las listas.</p>}
      <label>Quiero publicar
        <select value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="swap">Intercambiar un descanso</option>
          <option value="give">Ceder un descanso</option>
          <option value="want">Buscar un descanso</option>
        </select>
      </label>
      {kind !== "want" && <label>Mi DS o FS confirmado
        <select value={offeredDate} onChange={(event) => setOfferedDate(event.target.value)} required>
          <option value="">Selecciona un día</option>
          {days.rest.map((day) => <option key={day.date} value={day.date}>{formatDay(day.date)} · {day.code}</option>)}
        </select>
      </label>}
      {kind !== "give" && <label>Día en el que quiero descansar
        <select value={wantedDate} onChange={(event) => setWantedDate(event.target.value)} required>
          <option value="">Selecciona un día laborable</option>
          {days.work.map((day) => <option key={day.date} value={day.date}>{formatDay(day.date)}</option>)}
        </select>
      </label>}
      <p className="rest-exchange-note">Los SL y las vacaciones no se pueden ofrecer. Solo aparecen días verificados en tu calendario personal del portal.</p>
      <button type="submit" disabled={busy || loading}>{busy ? "Guardando…" : "Publicar en el tablón"}</button>
    </form>}
    {tab === "board" && <div className="rest-exchange-list">
      {loading ? <p>Cargando publicaciones…</p> : board.length ? board.map((offer) => offerCard(offer)) : <p>No hay publicaciones abiertas todavía.</p>}
    </div>}
    {tab === "mine" && <div className="rest-exchange-list">
      {loading ? <p>Cargando acuerdos…</p> : mine.length ? mine.map((offer) => offerCard(offer, true)) : <p>Aún no tienes publicaciones ni propuestas.</p>}
    </div>}
  </section>;
}
