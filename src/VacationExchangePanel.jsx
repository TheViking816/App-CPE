import ExchangeFilters, { useExchangeFilters } from "./ExchangeFilters.jsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { conversationHash } from "./ExchangeConversations.jsx";
import { EXCHANGE_PREVIEW_READ_ONLY } from "./exchangePreview.js";
import { counterpartName, recentPersonalOffers } from "./exchangeDisplay.js";
import { ExchangeAvatar, ExchangeDate, ExchangeHeroIcon, ExchangeTabIcon } from "./ExchangeVisual.jsx";
import { canRespondToVacationOffer, dateRangeKeys } from "./vacationExchange.js";
import { professionalGroupCode, professionalGroupLabel } from "./professionalGroups.js";
import ExchangeBoardCalendar from "./ExchangeBoardCalendar.jsx";
import { supabase } from "./supabaseClient.js";
import { madridTodayKey, vacationOfferExpired } from "./exchangeDeadline.js";
import useExchangeOfferFocus from "./useExchangeOfferFocus.js";
import {
  cancelVacationExchange, decideVacationExchange, getVacationExchange,
  proposeVacationExchange, publishVacationExchange, updateVacationExchange,
  withdrawVacationExchange
} from "./exchangeClient.js";

function formatDay(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatRange(start, end) {
  return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`;
}

export default function VacationExchangePanel({ session }) {
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
  const [personalVacationLink, setPersonalVacationLink] = useState(false);
  const panelRef = useRef(null);

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
    let active = true;
    supabase.rpc('app_cpe_has_manual_noray_section_link', {
      p_token: session.token, p_section: 'vacaciones'
    }).then(({ data, error }) => {
      if (active) setPersonalVacationLink(!error && data === true);
    }).catch(() => { if (active) setPersonalVacationLink(false); });
    return () => { active = false; };
  }, [session.token]);

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
    const today = madridTodayKey();
    if (offeredStart <= today || wantedStart <= today) {
      setError("Los dos periodos deben comenzar después de hoy.");
      return;
    }
    const offered = dateRangeKeys(offeredStart, offeredEnd);
    const wanted = dateRangeKeys(wantedStart, wantedEnd);
    if (!offered.length || offered.length !== wanted.length) {
      setError("Los dos periodos deben tener el mismo número de días, entre 1 y 31.");
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
  const today = madridTodayKey();
  const board = offers.filter((offer) => offer.status === "open"
    && !vacationOfferExpired(offer, today));
  const { filters, setFilters, visible } = useExchangeFilters(board, true);
  const focusedOfferId = useExchangeOfferFocus("vacaciones", panelRef, loading, tab, setTab, visible, setFilters);
  const mine = recentPersonalOffers(offers, proposals);

  function offerCard(offer, personal = false) {
    const expired = offer.status === "open" && vacationOfferExpired(offer, today);
    const related = proposals.filter((proposal) => proposal.offerId === offer.id);
    const minePending = related.find((proposal) => proposal.isOwn && proposal.status === "pending");
    const canRespond = canRespondToVacationOffer(offer, session.professionalGroup);
    const groupMatches = professionalGroupCode(offer.professionalGroup)
      && professionalGroupCode(offer.professionalGroup) === professionalGroupCode(session.professionalGroup);
    const chatButton = (proposal) => <button type="button" className="rest-exchange-secondary"
      onClick={() => { window.location.hash = conversationHash("vacation", proposal.id); }}>
      Abrir conversación
    </button>;

    return <article className={`rest-exchange-offer${offer.id === focusedOfferId ? " is-notification-target" : ""}`}
      key={offer.id} data-kind="vacation" data-offer-id={offer.id} tabIndex={offer.id === focusedOfferId ? -1 : undefined}>
      <div className="rest-exchange-offer-head">
        <ExchangeAvatar name={offer.ownerName} />
        <div><span>Intercambio de vacaciones</span><strong>{offer.ownerName || "Compañero"}{offer.ownerChapa ? ` · ${offer.ownerChapa}` : ""}</strong></div>
        {(offer.professionalGroup || offer.restGroup) && <div className="rest-exchange-offer-groups">
          {offer.professionalGroup && <small>Grupo profesional: {professionalGroupLabel(offer.professionalGroup)}</small>}
          {offer.restGroup && <small>Descanso: {offer.restGroup}</small>}
        </div>}
      </div>
      <div className="rest-exchange-dates">
        <div><small>Tengo · {dateRangeKeys(offer.offeredStart, offer.offeredEnd).length} días</small><ExchangeDate start={offer.offeredStart} end={offer.offeredEnd} /></div>
        <div><small>Quiero</small><ExchangeDate start={offer.wantedStart} end={offer.wantedEnd} /></div>
      </div>
      {personal && <span className="rest-exchange-status">{offer.status === "agreed" ? "Acordado · pendiente del Portal SEVASA" : expired ? "Caducada" : "Abierto"}</span>}
      {offer.status === "open" && !expired && !offer.isOwn && !minePending && <div className="rest-exchange-actions">
        <button type="button" disabled={busy || !canRespond} onClick={() => mutate(
          () => proposeVacationExchange({ token: session.token, offerId: offer.id }),
          "Propuesta enviada. El autor recibirá una notificación."
        )}>Me interesa</button>
        {!groupMatches && <small>{session.professionalGroup ? 'Solo puedes intercambiar vacaciones con tu mismo grupo profesional.' : 'Indica tu grupo profesional en Ajustes → Mis datos.'}</small>}
      </div>}
      {offer.isOwn && offer.status === "open" && <div className="rest-exchange-manage">
        <button type="button" className="rest-exchange-secondary" disabled={busy || expired || related.some((p) => p.status === "pending")}
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
            <button type="button" disabled={busy || expired} onClick={() => mutate(
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

  return <section className="rest-exchange-panel vacation-exchange-panel exchange-redesign" ref={panelRef}>
    <div className="rest-exchange-heading vacation-exchange-heading"><ExchangeHeroIcon vacation /><div><p>Entre compañeros · Vacaciones</p><h2>Intercambiar vacaciones</h2></div>
      {personalVacationLink && <form className="personal-portal-link vacation-portal-link" action="/api/noray-section" method="post" target="_blank" rel="noopener noreferrer"><input type="hidden" name="token" value={session.token} /><input type="hidden" name="section" value="vacaciones" /><button type="submit">Solicitar vacaciones <ExternalLink size={17} aria-hidden="true" /></button></form>}
    </div>
    <ExchangeBoardCalendar offers={board} selectedDate={filters.date} vacation onSelectDate={(date) => { setTab("board"); setFilters((current) => ({ ...current, date })); }} />
    <div className="rest-exchange-tabs" role="tablist" aria-label="Intercambios de vacaciones">
      {[["board", "Tablón"], ["publish", "Publicar"], ["mine", "Mis Ofertas"]].map(([value, label]) =>
        <button type="button" role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""}
          key={value} onClick={() => setTab(value)}><ExchangeTabIcon tab={value} />{label}</button>)}
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
      <p className="rest-exchange-note">Para un día suelto, indica la misma fecha en «desde» y «hasta».</p>
      <button type="submit" disabled={busy || loading}>{busy ? "Guardando…" : editingOfferId ? "Guardar cambios" : "Publicar en el tablón"}</button>
    </form>}
    {tab === "board" && <ExchangeFilters offers={board} filters={filters} setFilters={setFilters} count={visible.length} vacation={true} />}
    {tab === "board" && <div className="rest-exchange-list">
      {loading ? <p>Cargando publicaciones…</p> : visible.length ? visible.map((offer) => offerCard(offer)) : <p>{board.length ? "No hay ofertas que coincidan con estos filtros." : "No hay publicaciones abiertas todavía."}</p>}
    </div>}
    {tab === "mine" && <div className="rest-exchange-list">
      {loading ? <p>Cargando gestiones…</p> : mine.length ? mine.map((offer) => offerCard(offer, true)) : <p>Aún no tienes publicaciones ni propuestas.</p>}
    </div>}
  </section>;
}
