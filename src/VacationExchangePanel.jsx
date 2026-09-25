import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { conversationHash } from "./ExchangeConversations.jsx";
import { EXCHANGE_PREVIEW_READ_ONLY } from "./exchangePreview.js";
import { counterpartName, recentPersonalOffers } from "./exchangeDisplay.js";
import { assignedVacationDays, canRespondToVacationOffer, dateRangeKeys, vacationSelectionPatch } from "./vacationExchange.js";
import {
  cancelVacationExchange, decideVacationExchange, getVacationExchange,
  proposeVacationExchange, publishVacationExchange, updateVacationExchange,
  withdrawVacationExchange
} from "./supabaseClient.js";

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatDay(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatRange(start, end) {
  return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`;
}

export default function VacationExchangePanel({ session, vacaciones, selectedDay }) {
  const [tab, setTab] = useState("board");
  const [offeredStart, setOfferedStart] = useState("");
  const [offeredEnd, setOfferedEnd] = useState("");
  const [wantedStart, setWantedStart] = useState("");
  const [wantedEnd, setWantedEnd] = useState("");
  const [editingOfferId, setEditingOfferId] = useState("");
  const [data, setData] = useState({ offers: [], proposals: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const panelRef = useRef(null);
  const assignedDays = useMemo(() => assignedVacationDays(vacaciones), [vacaciones]);

  const reload = useCallback(async ({ quiet = false } = {}) => {
    if (!session?.token) return;
    if (!quiet) setLoading(true);
    try {
      setData(await getVacationExchange({ token: session.token }));
      setError("");
    } catch (loadError) {
      setError(loadError.message || "No se pudo cargar el tablón de vacaciones.");
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
    const patch = vacationSelectionPatch(selectedDay.dateKey, selectedDay.isVacation);
    setEditingOfferId("");
    setError("");
    setNotice("");
    setTab("publish");
    if (patch.offeredStart) {
      setOfferedStart(patch.offeredStart);
      setOfferedEnd(patch.offeredEnd);
    } else {
      setWantedStart(patch.wantedStart);
      setWantedEnd(patch.wantedEnd);
    }
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedDay]);

  async function mutate(action, message) {
    if (EXCHANGE_PREVIEW_READ_ONLY) {
      setError("Esta vista previa está en modo consulta para proteger los datos de producción.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
      await reload({ quiet: true });
    } catch (actionError) {
      setError(actionError.message || "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  }

  function publish(event) {
    event.preventDefault();
    const offered = dateRangeKeys(offeredStart, offeredEnd);
    const wanted = dateRangeKeys(wantedStart, wantedEnd);
    if (!offered.length || offered.length !== wanted.length) {
      setError("Los dos periodos deben tener el mismo número de días, entre 1 y 31.");
      return;
    }
    if (!offered.every((day) => assignedDays.has(day))) {
      setError("Todos los días que ofreces deben constar como vacaciones asignadas.");
      return;
    }
    if (wanted.some((day) => assignedDays.has(day))) {
      setError("El periodo que buscas ya contiene vacaciones asignadas.");
      return;
    }
    mutate(async () => {
      const params = { token: session.token, offeredStart, offeredEnd, wantedStart, wantedEnd };
      if (editingOfferId) {
        await updateVacationExchange({ ...params, offerId: editingOfferId });
        setEditingOfferId("");
      } else {
        await publishVacationExchange(params);
      }
      setTab("mine");
    }, editingOfferId ? "Publicación actualizada." : "Publicación creada.");
  }

  function editOffer(offer) {
    setEditingOfferId(offer.id);
    setOfferedStart(offer.offeredStart);
    setOfferedEnd(offer.offeredEnd);
    setWantedStart(offer.wantedStart);
    setWantedEnd(offer.wantedEnd);
    setError("");
    setNotice("");
    setTab("publish");
  }

  const offers = data.offers || [];
  const proposals = data.proposals || [];
  const today = todayKey();
  const board = offers.filter((offer) => offer.status === "open"
    && offer.offeredStart >= today && offer.wantedStart >= today);
  const mine = recentPersonalOffers(offers, proposals);

  function offerCard(offer, personal = false) {
    const related = proposals.filter((proposal) => proposal.offerId === offer.id);
    const minePending = related.find((proposal) => proposal.isOwn && proposal.status === "pending");
    const canRespond = canRespondToVacationOffer(offer, assignedDays);
    const chatButton = (proposal) => <button type="button" className="rest-exchange-secondary"
      onClick={() => { window.location.hash = conversationHash("vacation", proposal.id); }}>
      Abrir conversación
    </button>;

    return <article className="rest-exchange-offer" key={offer.id}>
      <div className="rest-exchange-offer-head">
        <div><span>Intercambio de vacaciones</span><strong>{offer.ownerName || "Compañero"}{offer.ownerChapa ? ` · ${offer.ownerChapa}` : ""}</strong></div>
        {(offer.professionalGroup || offer.restGroup) && <div className="rest-exchange-offer-groups">
          {offer.professionalGroup && <small>Grupo profesional: {offer.professionalGroup}</small>}
          {offer.restGroup && <small>Descanso: {offer.restGroup}</small>}
        </div>}
      </div>
      <div className="rest-exchange-dates">
        <div><small>Tengo · {dateRangeKeys(offer.offeredStart, offer.offeredEnd).length} días</small><strong>{formatRange(offer.offeredStart, offer.offeredEnd)}</strong></div>
        <div><small>Quiero</small><strong>{formatRange(offer.wantedStart, offer.wantedEnd)}</strong></div>
      </div>
      {personal && <span className="rest-exchange-status">{offer.status === "agreed" ? "Acordado · pendiente del Portal SEVASA" : "Abierto"}</span>}
      {offer.status === "open" && !offer.isOwn && !minePending && <div className="rest-exchange-actions">
        <button type="button" disabled={busy || !canRespond} onClick={() => mutate(
          () => proposeVacationExchange({ token: session.token, offerId: offer.id }),
          "Propuesta enviada. El autor recibirá una notificación."
        )}>Me interesa</button>
        {!canRespond && <small>Para responder, debes tener asignado el periodo que busca y no tener vacaciones en el que ofrece.</small>}
      </div>}
      {offer.isOwn && offer.status === "open" && <div className="rest-exchange-manage">
        <button type="button" className="rest-exchange-secondary" disabled={busy || related.some((p) => p.status === "pending")}
          onClick={() => editOffer(offer)}>Editar</button>
        <button type="button" className="rest-exchange-secondary" disabled={busy}
          onClick={() => mutate(() => cancelVacationExchange({ token: session.token, offerId: offer.id }),
            "Publicación eliminada.")}>Eliminar</button>
        {related.some((p) => p.status === "pending") && <small>Responde o rechaza las propuestas pendientes para poder editar.</small>}
      </div>}
      {minePending && <div className="rest-exchange-manage">{chatButton(minePending)}
        <button type="button" className="rest-exchange-secondary" disabled={busy}
          onClick={() => mutate(() => withdrawVacationExchange({ token: session.token, proposalId: minePending.id }),
            "Propuesta retirada.")}>Retirar mi propuesta</button></div>}
      {personal && related.filter((proposal) => proposal.status === "pending" && !proposal.isOwn)
        .map((proposal) => <div className="rest-exchange-proposal" key={proposal.id}>
          <span>{proposal.proposerName}{proposal.counterpartChapa ? ` · ${proposal.counterpartChapa}` : ""} ofrece {formatRange(offer.wantedStart, offer.wantedEnd)} y quiere {formatRange(offer.offeredStart, offer.offeredEnd)}.</span>
          <div>{chatButton(proposal)}
            <button type="button" disabled={busy} onClick={() => mutate(
              () => decideVacationExchange({ token: session.token, proposalId: proposal.id, accept: true }),
              "Acuerdo registrado. Falta tramitarlo y confirmarlo en el Portal SEVASA."
            )}>Aceptar</button>
            <button type="button" className="rest-exchange-secondary" disabled={busy} onClick={() => mutate(
              () => decideVacationExchange({ token: session.token, proposalId: proposal.id, accept: false }),
              "Propuesta rechazada."
            )}>Rechazar</button>
          </div>
        </div>)}
      {personal && related.filter((proposal) => proposal.status === "accepted").map((proposal) => <div className="rest-exchange-agreement" key={proposal.id}>
        <strong>Acuerdo con {counterpartName(offer, proposal)} {proposal.counterpartChapa}</strong>
        <span>{counterpartName(offer, proposal)} ofrece {formatRange(offer.isOwn ? offer.wantedStart : offer.offeredStart, offer.isOwn ? offer.wantedEnd : offer.offeredEnd)} y quiere {formatRange(offer.isOwn ? offer.offeredStart : offer.wantedStart, offer.isOwn ? offer.offeredEnd : offer.wantedEnd)}.</span>
        <span>En «Solicitud Vacaciones → Intercambio», indica CEDO: {formatRange(offer.isOwn ? offer.offeredStart : offer.wantedStart, offer.isOwn ? offer.offeredEnd : offer.wantedEnd)}; CAMBIO CON: chapa {proposal.counterpartChapa}; ME CEDE: {formatRange(offer.isOwn ? offer.wantedStart : offer.offeredStart, offer.isOwn ? offer.wantedEnd : offer.offeredEnd)}.</span>
        <span>El acuerdo en esta app no cambia tus vacaciones. Tramitadlo y comprobad su confirmación en el portal.</span>
        <a href="https://portal.cpevalencia.com/#User,ViewNoray,16" target="_blank" rel="noreferrer">Abrir intercambio en el Portal SEVASA ↗</a>
        {chatButton(proposal)}
      </div>)}
    </article>;
  }

  return <section className="rest-exchange-panel vacation-exchange-panel" ref={panelRef}>
    {EXCHANGE_PREVIEW_READ_ONLY && <p className="rest-exchange-note">Vista previa en modo consulta. No se guardarán cambios en las ofertas.</p>}
    <div className="rest-exchange-heading"><div><p>Entre compañeros</p><h2>Intercambiar vacaciones</h2></div></div>
    <p className="rest-exchange-intro">Publica un día suelto o un periodo seguido que tengas asignado y el periodo de igual duración que prefieres. El acuerdo se tramita y confirma en el Portal SEVASA.</p>
    <div className="rest-exchange-tabs" role="tablist" aria-label="Intercambios de vacaciones">
      {[["board", "Tablón"], ["publish", "Publicar"], ["mine", "Mis Ofertas"]].map(([value, label]) =>
        <button type="button" role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""}
          key={value} onClick={() => setTab(value)}>{label}</button>)}
    </div>
    {error && <p className="rest-exchange-error" role="alert">{error}</p>}
    {notice && <p className="rest-exchange-notice" role="status">{notice}</p>}
    {tab === "publish" && <form className="rest-exchange-form" onSubmit={publish}>
      {editingOfferId && <div className="rest-exchange-edit-heading"><strong>Editar publicación</strong>
        <button type="button" className="rest-exchange-secondary" onClick={() => setEditingOfferId("")}>Cancelar edición</button></div>}
      <div className="vacation-exchange-form-grid">
        <label>Tengo · desde<input type="date" required value={offeredStart} onChange={(event) => {
          setOfferedStart(event.target.value); if (!offeredEnd) setOfferedEnd(event.target.value);
        }} /></label>
        <label>Tengo · hasta<input type="date" required min={offeredStart} value={offeredEnd}
          onChange={(event) => setOfferedEnd(event.target.value)} /></label>
        <label>Quiero · desde<input type="date" required value={wantedStart} onChange={(event) => {
          setWantedStart(event.target.value); if (!wantedEnd) setWantedEnd(event.target.value);
        }} /></label>
        <label>Quiero · hasta<input type="date" required min={wantedStart} value={wantedEnd}
          onChange={(event) => setWantedEnd(event.target.value)} /></label>
      </div>
      <p className="rest-exchange-note">Para un día suelto, indica la misma fecha en «desde» y «hasta». Solo puedes ofrecer vacaciones asignadas en tu portal.</p>
      <button type="submit" disabled={busy || loading}>{busy ? "Guardando…" : editingOfferId ? "Guardar cambios" : "Publicar en el tablón"}</button>
    </form>}
    {tab === "board" && <div className="rest-exchange-list">
      {loading ? <p>Cargando publicaciones…</p> : board.length ? board.map((offer) => offerCard(offer)) : <p>No hay publicaciones abiertas todavía.</p>}
    </div>}
    {tab === "mine" && <div className="rest-exchange-list">
      {loading ? <p>Cargando gestiones…</p> : mine.length ? mine.map((offer) => offerCard(offer, true)) : <p>Aún no tienes publicaciones ni propuestas.</p>}
    </div>}
  </section>;
}
