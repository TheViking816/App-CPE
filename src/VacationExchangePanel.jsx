import ExchangeFilters, { useExchangeFilters } from "./ExchangeFilters.jsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { conversationHash } from "./ExchangeConversations.jsx";
import { EXCHANGE_PREVIEW_READ_ONLY } from "./exchangePreview.js";
import { counterpartName, recentPersonalOffers } from "./exchangeDisplay.js";
import { ExchangeAvatar, ExchangeDate, ExchangeTabIcon } from "./ExchangeVisual.jsx";
import { canRespondToVacationOffer, dateRangeKeys } from "./vacationExchange.js";
import { professionalGroupCode, professionalGroupLabel } from "./professionalGroups.js";
import ExchangeBoardCalendar from "./ExchangeBoardCalendar.jsx";
import { addManualPaidDayRange, deleteManualPaidDay, listManualPaidDays, saveManualPaidDay } from "./personalRestCalendarClient.js";
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
  const [paidDays, setPaidDays] = useState([]);
  const [vacationEditorOpen, setVacationEditorOpen] = useState(false);
  const [personalBusy, setPersonalBusy] = useState(false);
  const [vacationStart, setVacationStart] = useState(madridTodayKey());
  const [vacationEnd, setVacationEnd] = useState(madridTodayKey());
  const [paidType, setPaidType] = useState("VA");
  const [scrollTarget, setScrollTarget] = useState(null);
  const panelRef = useRef(null);
  const vacationEditorRef = useRef(null);
  const scrolledCalendarTargetRef = useRef(null);

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

  const reloadPaidDays = useCallback(async () => {
    if (!session?.token) return;
    try { setPaidDays(await listManualPaidDays(session.token) || []); }
    catch (loadError) { setError(loadError.message || "No se pudieron cargar tus vacaciones."); }
  }, [session?.token]);

  useEffect(() => { reloadPaidDays(); }, [reloadPaidDays]);

  useEffect(() => {
    if (vacationEditorOpen) vacationEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [vacationEditorOpen]);

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

  function openVacationEditor(date = madridTodayKey()) {
    setVacationStart(date);
    setVacationEnd(date);
    setPaidType(paidDays.find((row) => row.work_date === date)?.concept_type || "VA");
    setVacationEditorOpen(true);
    setError("");
  }

  async function saveVacationDays(event) {
    event.preventDefault();
    if (EXCHANGE_PREVIEW_READ_ONLY) return setError("Esta vista previa está en modo consulta.");
    setPersonalBusy(true);
    setError("");
    try {
      const current = vacationStart === vacationEnd ? paidDays.find((row) => row.work_date === vacationStart) : null;
      let count;
      if (current && current.concept_type !== paidType) {
        await saveManualPaidDay(session.token, vacationStart, paidType, current.id);
        count = 1;
      } else {
        count = await addManualPaidDayRange(session.token, vacationStart, vacationEnd, paidType);
      }
      await reloadPaidDays();
      setNotice(`${count} ${count === 1 ? "día guardado" : "días guardados"} como ${paidType}.`);
      setVacationEditorOpen(false);
    } catch (saveError) {
      setError(saveError.message || "No se pudieron guardar las vacaciones.");
    } finally {
      setPersonalBusy(false);
    }
  }

  async function removeVacationDay() {
    const row = paidDays.find((item) => item.work_date === vacationStart);
    if (!row || vacationStart !== vacationEnd) return;
    if (EXCHANGE_PREVIEW_READ_ONLY) return setError("Esta vista previa está en modo consulta.");
    setPersonalBusy(true);
    setError("");
    try {
      await deleteManualPaidDay(session.token, row.id);
      await reloadPaidDays();
      setNotice(`Día ${row.concept_type} eliminado.`);
      setVacationEditorOpen(false);
    } catch (removeError) {
      setError(removeError.message || "No se pudo eliminar el día.");
    } finally {
      setPersonalBusy(false);
    }
  }

  const offers = data.offers || [];
  const proposals = data.proposals || [];
  const today = madridTodayKey();
  const board = offers.filter((offer) => offer.status === "open"
    && !vacationOfferExpired(offer, today));
  const { filters, setFilters, visible } = useExchangeFilters(board, true);
  const focusedOfferId = useExchangeOfferFocus("vacaciones", panelRef, loading, tab, setTab, visible, setFilters);
  useEffect(() => {
    if (!scrollTarget || loading || tab !== "board" || scrolledCalendarTargetRef.current === scrollTarget) return;
    const card = Array.from(panelRef.current?.querySelectorAll("[data-offer-id]") || [])
      .find((item) => item.dataset.offerId === scrollTarget.id);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.focus({ preventScroll: true });
    scrolledCalendarTargetRef.current = scrollTarget;
  }, [scrollTarget, visible, loading, tab]);
  const mine = recentPersonalOffers(offers, proposals);

  function selectCalendarOffer(date) {
    const offer = board.find((row) => (row.offeredStart <= date && row.offeredEnd >= date)
      || (row.wantedStart <= date && row.wantedEnd >= date));
    setTab("board");
    setFilters({ search: "", group: "", kind: "", date });
    if (offer) setScrollTarget({ id: offer.id, date });
  }

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

    return <article className={`rest-exchange-offer${offer.id === focusedOfferId || offer.id === scrollTarget?.id ? " is-notification-target" : ""}`}
      key={offer.id} data-kind="vacation" data-offer-id={offer.id} tabIndex={offer.id === focusedOfferId || offer.id === scrollTarget?.id ? -1 : undefined}>
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
    {personalVacationLink && <form className="rest-portal-availability-link" action="/api/noray-section" method="post" target="_blank" rel="noopener noreferrer"><input type="hidden" name="token" value={session.token} /><input type="hidden" name="section" value="vacaciones" /><button type="submit">Solicitar vacaciones <ExternalLink size={15} aria-hidden="true" /></button></form>}
    <ExchangeBoardCalendar offers={board} paidDays={paidDays} selectedDate={filters.date} vacation onSelectDate={selectCalendarOffer} onEditDate={openVacationEditor} />
    <div className="rest-calendar-controls"><button type="button" onClick={() => vacationEditorOpen ? setVacationEditorOpen(false) : openVacationEditor()}>Añadir VA o FM</button><span>Los días VA y FM aparecen también en descansos y Sueldómetro.</span></div>
    {vacationEditorOpen && <form className="rest-calendar-editor" ref={vacationEditorRef} onSubmit={saveVacationDays}>
      <label>Desde<input type="date" value={vacationStart} onChange={(event) => { setVacationStart(event.target.value); setPaidType(paidDays.find((row) => row.work_date === event.target.value)?.concept_type || "VA"); if (vacationEnd < event.target.value) setVacationEnd(event.target.value); }} required /></label>
      <label>Hasta<input type="date" min={vacationStart} value={vacationEnd} onChange={(event) => setVacationEnd(event.target.value)} required /></label>
      <label>Tipo<select value={paidType} onChange={(event) => setPaidType(event.target.value)}><option value="VA">VA · Vacaciones</option><option value="FM">FM · Formación</option></select></label>
      <div><button type="submit" disabled={personalBusy}>Guardar días</button>{vacationStart === vacationEnd && paidDays.some((row) => row.work_date === vacationStart) && <button type="button" disabled={personalBusy} onClick={removeVacationDay}>Quitar día</button>}</div>
    </form>}
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
