import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canRespondToRestOffer, confirmedRestExchangeDays, restPortalProcedure } from "./restExchange.js";
import { conversationHash } from "./ExchangeConversations.jsx";
import { EXCHANGE_PREVIEW_READ_ONLY } from "./exchangePreview.js";
import { counterpartName, recentPersonalOffers } from "./exchangeDisplay.js";
import {
  cancelRestExchange,
  decideRestExchange,
  getRestExchange,
  proposeRestExchange,
  publishRestExchange,
  updateRestExchange,
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
  const [editingOfferId, setEditingOfferId] = useState("");
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
  const selectedCalendarRest = selectedDay?.source === "company" && selectedDay.code === "DS"
    && !restDates.has(selectedDay.dateKey) ? selectedDay.dateKey : "";

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
    setEditingOfferId("");
    setError("");
    setNotice("");
    setTab("publish");
    if (restDates.has(selectedDay.dateKey) || selectedCalendarRest) {
      setKind("swap");
      setOfferedDate(selectedDay.dateKey);
    } else if (workDates.has(selectedDay.dateKey)) {
      setKind("want");
      setWantedDate(selectedDay.dateKey);
    }
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedDay, selectedCalendarRest]);

  async function mutate(action, successMessage) {
    if (EXCHANGE_PREVIEW_READ_ONLY) {
      setError("Esta vista previa está en modo consulta para proteger los datos de producción.");
      return;
    }
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
    if (needing && !workDates.has(needing)) return setError("Elige un día disponible para solicitar en tu calendario del portal.");
    if ((kind === "swap" && (!giving || !needing || giving === needing))
      || (kind === "give" && !giving) || (kind === "want" && !needing)) {
      return setError("Selecciona los días correspondientes.");
    }
    return mutate(async () => {
      if (editingOfferId) {
        await updateRestExchange({ token: session.token, offerId: editingOfferId, kind,
          offeredDate: giving, wantedDate: needing });
        setEditingOfferId("");
      } else {
        await publishRestExchange({ token: session.token, kind,
          offeredDate: giving, wantedDate: needing });
      }
      setTab("mine");
    }, editingOfferId ? "Publicación actualizada." : "Publicación creada.");
  }

  function editOffer(offer) {
    setEditingOfferId(offer.id);
    setKind(offer.kind);
    setOfferedDate(offer.offeredDate || "");
    setWantedDate(offer.wantedDate || "");
    setError("");
    setNotice("");
    setTab("publish");
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const offers = data.offers || [];
  const today = todayKey();
  const board = offers.filter((offer) => offer.status === "open"
    && (!offer.offeredDate || offer.offeredDate >= today)
    && (!offer.wantedDate || offer.wantedDate >= today));
  const mine = recentPersonalOffers(offers, data.proposals || []);
  const proposalsByOffer = (offerId) => (data.proposals || []).filter((proposal) => proposal.offerId === offerId);

  function offerCard(offer, personal = false) {
    const proposals = proposalsByOffer(offer.id);
    const myProposal = proposals.find((proposal) => proposal.isOwn && ["pending", "accepted"].includes(proposal.status));
    const canRespond = canRespondToRestOffer(offer, restDates, workDates);
    const chatButton = (proposal) => <button type="button" className="rest-exchange-secondary"
      onClick={() => { window.location.hash = conversationHash("rest", proposal.id); }}>
      Abrir conversación
    </button>;
    return <article className="rest-exchange-offer" key={offer.id}>
      <div className="rest-exchange-offer-head">
        <div><span>{KINDS[offer.kind]}</span><strong>{offer.ownerName || "Compañero"}{offer.ownerChapa ? ` · ${offer.ownerChapa}` : ""}</strong></div>
        {(offer.professionalGroup || offer.ownerGroup) && <div className="rest-exchange-offer-groups">
          {offer.professionalGroup && <small>Grupo profesional: {offer.professionalGroup}</small>}
          {offer.ownerGroup && <small>Descanso: {offer.ownerGroup}</small>}
        </div>}
      </div>
      <div className="rest-exchange-dates">
        {offer.offeredDate && <div><small>Ofrece</small><strong>{formatDay(offer.offeredDate)}</strong></div>}
        {offer.wantedDate && <div><small>Busca</small><strong>{formatDay(offer.wantedDate)}</strong></div>}
      </div>
      {personal && <span className="rest-exchange-status">{offer.status === "agreed" ? "Acordado · pendiente de tramitar en el portal" : "Abierto"}</span>}
      {offer.status === "open" && !offer.isOwn && !myProposal && <div className="rest-exchange-actions">
        <button type="button" disabled={busy || !canRespond} onClick={() => mutate(
          () => proposeRestExchange({ token: session.token, offerId: offer.id,
            offeredDate: offer.kind === "give" ? null : offer.wantedDate }),
          "Propuesta enviada. El autor recibirá una notificación."
        )}>Me interesa</button>
        {!canRespond && <small>{offer.offeredDate && !workDates.has(offer.offeredDate)
          ? "Ese día no figura como disponible para ti en el portal."
          : "No tienes el día solicitado como DS o FS confirmado."}</small>}
      </div>}
      {offer.isOwn && offer.status === "open" && <div className="rest-exchange-manage">
        <button type="button" className="rest-exchange-secondary" disabled={busy || proposals.some((proposal) => proposal.status === "pending")}
          onClick={() => editOffer(offer)}>Editar</button>
        <button type="button" className="rest-exchange-secondary" disabled={busy}
          onClick={() => mutate(() => cancelRestExchange({ token: session.token, offerId: offer.id }), "Publicación eliminada.")}>Eliminar</button>
        {proposals.some((proposal) => proposal.status === "pending") && <small>Responde o rechaza las propuestas pendientes para poder editar.</small>}
      </div>}
      {myProposal?.status === "pending" && <div className="rest-exchange-manage">
        {chatButton(myProposal)}
        <button type="button" className="rest-exchange-secondary" disabled={busy}
          onClick={() => mutate(() => withdrawRestExchange({ token: session.token, proposalId: myProposal.id }), "Propuesta retirada.")}>Retirar mi propuesta</button>
      </div>}
      {personal && proposals.filter((proposal) => proposal.status === "pending" && !proposal.isOwn).map((proposal) => <div className="rest-exchange-proposal" key={proposal.id}>
        <span>{offer.kind === "give"
          ? `${proposal.proposerName}${proposal.counterpartChapa ? ` · ${proposal.counterpartChapa}` : ""} quiere ${formatDay(offer.offeredDate)}.`
          : offer.kind === "want"
            ? `${proposal.proposerName}${proposal.counterpartChapa ? ` · ${proposal.counterpartChapa}` : ""} ofrece ${formatDay(proposal.offeredDate)} para cedértelo.`
            : `${proposal.proposerName}${proposal.counterpartChapa ? ` · ${proposal.counterpartChapa}` : ""} ofrece ${formatDay(proposal.offeredDate)} y quiere ${formatDay(offer.offeredDate)}.`}</span>
        <div>{chatButton(proposal)}<button type="button" disabled={busy} onClick={() => mutate(
          () => decideRestExchange({ token: session.token, proposalId: proposal.id, accept: true }),
          "Acuerdo registrado. Falta tramitarlo en el portal oficial."
        )}>Aceptar</button><button type="button" className="rest-exchange-secondary" disabled={busy} onClick={() => mutate(
          () => decideRestExchange({ token: session.token, proposalId: proposal.id, accept: false }),
          "Propuesta rechazada."
        )}>Rechazar</button></div>
      </div>)}
      {personal && proposals.filter((proposal) => proposal.status === "accepted").map((proposal) => {
        const procedure = restPortalProcedure(offer, proposal);
        const name = counterpartName(offer, proposal);
        return <div className="rest-exchange-agreement" key={proposal.id}>
          <strong>Acuerdo con {name} {proposal.counterpartChapa}</strong>
          <span>{offer.kind === "swap"
            ? `${name} ofrece ${formatDay(offer.isOwn ? proposal.offeredDate : offer.offeredDate)} y quiere ${formatDay(offer.isOwn ? offer.offeredDate : proposal.offeredDate)}.`
            : offer.kind === "give"
              ? offer.isOwn ? `${name} quiere ${formatDay(offer.offeredDate)}.` : `${name} ofrece ${formatDay(offer.offeredDate)}.`
              : offer.isOwn ? `${name} ofrece ${formatDay(proposal.offeredDate)}.` : `${name} quiere ${formatDay(offer.wantedDate)}.`}</span>
          <span>{procedure.instruction}</span>
          <span>El acuerdo aquí no modifica el calendario oficial. Comprueba el estado de la petición en el Portal CPE.</span>
          <a href={procedure.url} target="_blank" rel="noreferrer">{procedure.label} ↗</a>
          {chatButton(proposal)}
        </div>;
      })}
    </article>;
  }

  return <section className="rest-exchange-panel" ref={panelRef}>
    {EXCHANGE_PREVIEW_READ_ONLY && <p className="rest-exchange-note">Vista previa en modo consulta. No se guardarán cambios en las ofertas.</p>}
    <div className="rest-exchange-heading"><div><p>Entre compañeros</p><h2>Intercambios y cesiones</h2></div></div>
    <p className="rest-exchange-intro">Publica un DS o FS, busca el día que necesitas y acordadlo aquí. El cambio solo será efectivo cuando lo tramitéis en el portal oficial.</p>
    <div className="rest-exchange-tabs" role="tablist" aria-label="Intercambios de descansos">
      {[["board", "Tablón"], ["publish", "Publicar"], ["mine", "Mis Ofertas"]].map(([value, label]) =>
        <button type="button" role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} key={value} onClick={() => setTab(value)}>{label}</button>)}
    </div>
    {error && <p className="rest-exchange-error" role="alert">{error}</p>}
    {notice && <p className="rest-exchange-notice" role="status">{notice}</p>}
    {tab === "publish" && <form className="rest-exchange-form" onSubmit={publish}>
      {editingOfferId && <div className="rest-exchange-edit-heading"><strong>Editar publicación</strong><button type="button" className="rest-exchange-secondary" onClick={() => setEditingOfferId("")}>Cancelar edición</button></div>}
      {selectedDay && !restDates.has(selectedDay.dateKey) && !workDates.has(selectedDay.dateKey) &&
        <p className="rest-exchange-note">{selectedCalendarRest
          ? "Este DS figura en el calendario anual del grupo. Para publicarlo, debe aparecer también en tu calendario personal sincronizado del portal."
          : "El día seleccionado aún no consta como DS, FS o día disponible en el portal. Elige otro día de las listas."}</p>}
      <label>Quiero publicar
        <select value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="swap">Intercambiar un descanso</option>
          <option value="give">Ceder un descanso</option>
          <option value="want">Buscar un descanso</option>
        </select>
      </label>
      {kind !== "want" && <label>Tengo
        <select value={offeredDate} onChange={(event) => setOfferedDate(event.target.value)} required>
          <option value="">Selecciona un día</option>
          {selectedCalendarRest && <option value={selectedCalendarRest}>{formatDay(selectedCalendarRest)} · DS · calendario anual</option>}
          {days.rest.map((day) => <option key={day.date} value={day.date}>{formatDay(day.date)} · {day.code}</option>)}
        </select>
      </label>}
      {kind !== "give" && <label>Quiero
        <select value={wantedDate} onChange={(event) => setWantedDate(event.target.value)} required>
          <option value="">Selecciona un día</option>
          {days.work.map((day) => <option key={day.date} value={day.date}>{formatDay(day.date)}{day.code ? ` · ${day.code}` : ""}</option>)}
        </select>
      </label>}
      <button type="submit" disabled={busy || loading || (kind !== "want" && Boolean(selectedCalendarRest) && offeredDate === selectedCalendarRest)}>{busy ? "Guardando…" : editingOfferId ? "Guardar cambios" : "Publicar en el tablón"}</button>
    </form>}
    {tab === "board" && <div className="rest-exchange-list">
      {loading ? <p>Cargando publicaciones…</p> : board.length ? board.map((offer) => offerCard(offer)) : <p>No hay publicaciones abiertas todavía.</p>}
    </div>}
    {tab === "mine" && <div className="rest-exchange-list">
      {loading ? <p>Cargando acuerdos…</p> : mine.length ? mine.map((offer) => offerCard(offer, true)) : <p>Aún no tienes publicaciones ni propuestas.</p>}
    </div>}
  </section>;
}
