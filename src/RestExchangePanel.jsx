import ExchangeFilters, { useExchangeFilters } from "./ExchangeFilters.jsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canRespondToRestOffer, restPortalProcedure } from "./restExchange.js";
import { madridTodayKey, restOfferExpired } from "./exchangeDeadline.js";
import { conversationHash } from "./ExchangeConversations.jsx";
import { EXCHANGE_PREVIEW_READ_ONLY } from "./exchangePreview.js";
import { counterpartName, recentPersonalOffers } from "./exchangeDisplay.js";
import { ExchangeAvatar, ExchangeDate, ExchangeHeroIcon, ExchangeTabIcon } from "./ExchangeVisual.jsx";
import { professionalGroupLabel } from "./professionalGroups.js";
import useExchangeOfferFocus from "./useExchangeOfferFocus.js";
import ExchangeBoardCalendar from "./ExchangeBoardCalendar.jsx";
import { deleteManualPaidDay, deleteRestDayOverride, getPersonalRestCalendar, saveManualPaidDay, saveRestDayOverride } from "./personalRestCalendarClient.js";
import {
  cancelRestExchange,
  decideRestExchange,
  getRestExchange,
  proposeRestExchange,
  publishRestExchange,
  updateRestExchange,
  withdrawRestExchange
} from "./exchangeClient.js";

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

export default function RestExchangePanel({ session }) {
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
  const [calendarData, setCalendarData] = useState({ overrides: [], paidDays: [], holidays: [], jornales: {} });
  const [calendarError, setCalendarError] = useState("");
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [editCalendar, setEditCalendar] = useState(false);
  const [editDate, setEditDate] = useState(madridTodayKey());
  const [editType, setEditType] = useState("REST");
  const [scrollTarget, setScrollTarget] = useState(null);
  const panelRef = useRef(null);
  const calendarEditorRef = useRef(null);
  const scrolledCalendarTargetRef = useRef(null);

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

  const reloadCalendar = useCallback(async () => {
    if (!session?.token) return;
    try {
      setCalendarData(await getPersonalRestCalendar(session.token));
      setCalendarError("");
    } catch (loadError) {
      setCalendarError(loadError.message || "No se pudo cargar tu calendario personal.");
    }
  }, [session?.token]);

  useEffect(() => { reloadCalendar(); }, [reloadCalendar]);

  useEffect(() => {
    if (!editCalendar) return;
    calendarEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [editCalendar, editDate]);

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
    const today = madridTodayKey();
    if ((giving && giving <= today) || (needing && needing <= today))
      return setError("Las dos fechas deben ser posteriores a hoy. El intercambio se cierra al comenzar cualquiera de los días.");
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

  function openCalendarEditor(date = madridTodayKey(), preferredType = "") {
    setEditDate(date);
    setEditType(preferredType || calendarData.paidDays.find((row) => row.work_date === date)?.concept_type || calendarData.overrides.find((row) => row.work_date === date)?.day_type || "REST");
    setEditCalendar(true);
    setCalendarError("");
  }

  async function changePersonalDay(action) {
    if (EXCHANGE_PREVIEW_READ_ONLY) return setCalendarError("Esta vista previa está en modo consulta.");
    if (!editDate) return setCalendarError("Selecciona una fecha.");
    const paid = calendarData.paidDays.find((row) => row.work_date === editDate);
    setCalendarBusy(true);
    setCalendarError("");
    try {
      if (action === "reset") {
        if (paid) await deleteManualPaidDay(session.token, paid.id);
        else await deleteRestDayOverride(session.token, editDate);
      } else if (editType === "VA" || editType === "FM") {
        await saveManualPaidDay(session.token, editDate, editType, paid?.id || null);
      } else {
        if (paid) await deleteManualPaidDay(session.token, paid.id);
        await saveRestDayOverride(session.token, editDate, editType);
      }
      await reloadCalendar();
      setNotice(action === "reset" ? "Día restablecido según tu grupo." : "Día guardado en tu calendario personal.");
      setEditCalendar(false);
    } catch (saveError) {
      setCalendarError(saveError.message || "No se pudo guardar el día.");
    } finally {
      setCalendarBusy(false);
    }
  }

  const offers = data.offers || [];
  const today = madridTodayKey();
  const board = offers.filter((offer) => offer.status === "open"
    && !restOfferExpired(offer, today));
  const { filters, setFilters, visible } = useExchangeFilters(board, false);
  const focusedOfferId = useExchangeOfferFocus("descansos", panelRef, loading, tab, setTab, visible, setFilters);
  useEffect(() => {
    if (!scrollTarget || loading || tab !== "board" || scrolledCalendarTargetRef.current === scrollTarget) return;
    const card = Array.from(panelRef.current?.querySelectorAll("[data-offer-id]") || [])
      .find((item) => item.dataset.offerId === scrollTarget.id);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.focus({ preventScroll: true });
    scrolledCalendarTargetRef.current = scrollTarget;
  }, [scrollTarget, visible, loading, tab]);
  const mine = recentPersonalOffers(offers, data.proposals || []);
  const proposalsByOffer = (offerId) => (data.proposals || []).filter((proposal) => proposal.offerId === offerId);

  function selectCalendarOffer(date) {
    const offer = board.find((row) => row.offeredDate === date || row.wantedDate === date);
    setTab("board");
    setFilters({ search: "", group: "", kind: "", date });
    if (offer) setScrollTarget({ id: offer.id, date });
  }

  function offerCard(offer, personal = false) {
    const expired = offer.status === "open" && restOfferExpired(offer, today);
    const proposals = proposalsByOffer(offer.id);
    const myProposal = proposals.find((proposal) => proposal.isOwn && ["pending", "accepted"].includes(proposal.status));
    const canRespond = canRespondToRestOffer(offer);
    const chatButton = (proposal) => <button type="button" className="rest-exchange-secondary"
      onClick={() => { window.location.hash = conversationHash("rest", proposal.id); }}>
      Abrir conversación
    </button>;
    return <article className={`rest-exchange-offer${offer.id === focusedOfferId || offer.id === scrollTarget?.id ? " is-notification-target" : ""}`}
      key={offer.id} data-kind={offer.kind} data-offer-id={offer.id} tabIndex={offer.id === focusedOfferId || offer.id === scrollTarget?.id ? -1 : undefined}>
      <div className="rest-exchange-offer-head">
        <ExchangeAvatar name={offer.ownerName} />
        <div><span>{KINDS[offer.kind]}</span><strong>{offer.ownerName || "Compañero"}{offer.ownerChapa ? ` · ${offer.ownerChapa}` : ""}</strong></div>
        {(offer.professionalGroup || offer.ownerGroup) && <div className="rest-exchange-offer-groups">
          {offer.professionalGroup && <small>Grupo profesional: {professionalGroupLabel(offer.professionalGroup)}</small>}
          {offer.ownerGroup && <small>Descanso: {offer.ownerGroup}</small>}
        </div>}
      </div>
      <div className="rest-exchange-dates">
        {offer.offeredDate && <div><small>Ofrece</small><ExchangeDate start={offer.offeredDate} /></div>}
        {offer.wantedDate && <div><small>Busca</small><ExchangeDate start={offer.wantedDate} /></div>}
      </div>
      {personal && <span className="rest-exchange-status">{offer.status === "agreed" ? "Acordado · pendiente de tramitar en el portal" : expired ? "Caducada" : "Abierto"}</span>}
      {offer.status === "open" && !expired && !offer.isOwn && !myProposal && <div className="rest-exchange-actions">
        <button type="button" disabled={busy || !canRespond} onClick={() => mutate(
          () => proposeRestExchange({ token: session.token, offerId: offer.id,
            offeredDate: offer.kind === "give" ? null : offer.wantedDate }),
          "Propuesta enviada. El autor recibirá una notificación."
        )}>Me interesa</button>
      </div>}
      {offer.isOwn && offer.status === "open" && <div className="rest-exchange-manage">
        <button type="button" className="rest-exchange-secondary" disabled={busy || expired || proposals.some((proposal) => proposal.status === "pending")}
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
        <div>{chatButton(proposal)}<button type="button" disabled={busy || expired} onClick={() => mutate(
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
          <span>El acuerdo aquí no modifica el calendario oficial. Comprueba el estado de la petición en el Portal SEVASA.</span>
          <a href={procedure.url} target="_blank" rel="noreferrer">{procedure.label} ↗</a>
          {chatButton(proposal)}
        </div>;
      })}
    </article>;
  }

  return <section className="rest-exchange-panel exchange-redesign" ref={panelRef}>
    <div className="rest-exchange-heading"><ExchangeHeroIcon /><div><p>Entre compañeros · Descansos</p><h2>Intercambios y cesiones</h2></div></div>
    <ExchangeBoardCalendar offers={board} restGroup={session?.restGroup} overrides={calendarData.overrides} paidDays={calendarData.paidDays} holidays={calendarData.holidays} jornales={calendarData.jornales}
      selectedDate={filters.date} onSelectDate={selectCalendarOffer} onEditDate={openCalendarEditor} />
    <div className="rest-calendar-controls"><button type="button" onClick={() => editCalendar ? setEditCalendar(false) : openCalendarEditor()}>Editar mis días</button><button type="button" onClick={() => openCalendarEditor(madridTodayKey(), "VA")}>Añadir VA o FM</button><span>DS, FS, FM y VA se muestran solo en tu calendario.</span></div>
    {calendarError && <p className="rest-exchange-error" role="alert">{calendarError}</p>}
    {editCalendar && <form className="rest-calendar-editor" ref={calendarEditorRef} onSubmit={(event) => { event.preventDefault(); changePersonalDay("save"); }}>
      <label>Fecha<input type="date" value={editDate} onChange={(event) => { setEditDate(event.target.value); setEditType(calendarData.paidDays.find((row) => row.work_date === event.target.value)?.concept_type || calendarData.overrides.find((row) => row.work_date === event.target.value)?.day_type || "REST"); }} required /></label>
      <label>Marcar día<select value={editType} onChange={(event) => setEditType(event.target.value)}>
        <option value="REST">DS · Descanso</option><option value="FS">FS · Festivo seleccionado</option><option value="WORK">Disponible</option><option value="VA">VA · Vacaciones</option><option value="FM">FM · Formación</option>
      </select></label>
      <div><button type="submit" disabled={calendarBusy}>Guardar día</button><button type="button" disabled={calendarBusy} onClick={() => changePersonalDay("reset")}>{calendarData.paidDays.some((row) => row.work_date === editDate) ? "Quitar VA o FM" : "Usar calendario del grupo"}</button></div>
    </form>}
    <div className="rest-exchange-tabs" role="tablist" aria-label="Intercambios de descansos">
      {[["board", "Tablón"], ["publish", "Publicar"], ["mine", "Mis Ofertas"]].map(([value, label]) =>
        <button type="button" role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} key={value} onClick={() => setTab(value)}><ExchangeTabIcon tab={value} />{label}</button>)}
    </div>
    {error && <p className="rest-exchange-error" role="alert">{error}</p>}
    {notice && <p className="rest-exchange-notice" role="status">{notice}</p>}
    {tab === "publish" && <form className="rest-exchange-form" onSubmit={publish}>
      {editingOfferId && <div className="rest-exchange-edit-heading"><strong>Editar publicación</strong><button type="button" className="rest-exchange-secondary" onClick={() => setEditingOfferId("")}>Cancelar edición</button></div>}
      <label>Quiero publicar
        <select value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="swap">Intercambiar un descanso</option>
          <option value="give">Ceder un descanso</option>
          <option value="want">Buscar un descanso</option>
        </select>
      </label>
      {kind !== "want" && <label>Tengo (descanso que ofrezco)
        <input type="date" value={offeredDate} min={today} onChange={(event) => setOfferedDate(event.target.value)} required />
      </label>}
      {kind !== "give" && <label>Quiero (fecha que busco)
        <input type="date" value={wantedDate} min={today} onChange={(event) => setWantedDate(event.target.value)} required />
      </label>}
      <p className="rest-exchange-note">Indica las fechas según tu calendario oficial. Solo se publicará tu oferta; no cambia tus descansos en el portal.</p>
      <button type="submit" disabled={busy || loading}>{busy ? "Guardando…" : editingOfferId ? "Guardar cambios" : "Publicar en el tablón"}</button>
    </form>}
    {tab === "board" && <ExchangeFilters offers={board} filters={filters} setFilters={setFilters} count={visible.length} vacation={false} />}
    {tab === "board" && <div className="rest-exchange-list">
      {loading ? <p>Cargando publicaciones…</p> : visible.length ? visible.map((offer) => offerCard(offer)) : <p>{board.length ? "No hay ofertas que coincidan con estos filtros." : "No hay publicaciones abiertas todavía."}</p>}
    </div>}
    {tab === "mine" && <div className="rest-exchange-list">
      {loading ? <p>Cargando acuerdos…</p> : mine.length ? mine.map((offer) => offerCard(offer, true)) : <p>Aún no tienes publicaciones ni propuestas.</p>}
    </div>}
  </section>;
}

