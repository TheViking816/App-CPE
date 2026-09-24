import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, Inbox, MessageCircle, Sun } from "lucide-react";
import PrivateExchangeChat from "./PrivateExchangeChat.jsx";
import { EXCHANGE_PREVIEW_READ_ONLY } from "./exchangePreview.js";
import { getExchangeThreads, markExchangeThreadRead } from "./supabaseClient.js";

const THREAD_HASH = /^#\/conversaciones\/(rest|vacation)\/([0-9a-f-]{36})$/i;

export function conversationHash(type, proposalId) {
  return `#/conversaciones/${type}/${proposalId}`;
}

function selectionFromHash() {
  const match = window.location.hash.match(THREAD_HASH);
  return match ? `${match[1]}:${match[2]}` : "";
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("es-ES", {
    day: "numeric", month: "short", year: "numeric"
  }).format(date);
}

function formatRange(start, end) {
  const first = formatDate(start);
  return end && end !== start ? `${first} – ${formatDate(end)}` : first;
}

function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("es-ES", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function isActive(thread) {
  return thread.offerStatus !== "cancelled" && ["pending", "accepted"].includes(thread.status);
}

function threadStatus(thread) {
  if (thread.offerStatus === "cancelled") return "Oferta retirada";
  return ({ pending: "Propuesta abierta", accepted: "Acuerdo · pendiente del portal",
    rejected: "Propuesta rechazada", withdrawn: "Propuesta retirada" })[thread.status] || "Archivada";
}

export default function ExchangeConversations({ session }) {
  const [threads, setThreads] = useState([]);
  const [selectedKey, setSelectedKey] = useState(selectionFromHash);
  const [filter, setFilter] = useState("active");
  const [typeFilter, setTypeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      setThreads(await getExchangeThreads({ token: session.token }));
      setError("");
    } catch (loadError) {
      setError(loadError.message || "No se pudieron cargar las conversaciones.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    reload();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") reload({ quiet: true });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    const onHash = () => setSelectedKey(selectionFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const selected = threads.find((thread) => `${thread.type}:${thread.proposalId}` === selectedKey);
  useEffect(() => {
    if (!selected || !selected.unread) return;
    markExchangeThreadRead({ token: session.token, type: selected.type, proposalId: selected.proposalId })
      .then(() => setThreads((current) => current.map((thread) =>
        thread.type === selected.type && thread.proposalId === selected.proposalId
          ? { ...thread, unread: 0 } : thread)))
      .catch(() => {});
  }, [session.token, selected?.type, selected?.proposalId, selected?.unread]);

  const visible = useMemo(() => threads.filter((thread) =>
    (filter === "active" ? isActive(thread) : !isActive(thread))
    && (typeFilter === "all" || thread.type === typeFilter)), [threads, filter, typeFilter]);
  const activeCount = threads.filter(isActive).length;
  const archivedCount = threads.length - activeCount;
  const unreadCount = threads.reduce((sum, thread) => sum + Number(thread.unread || 0), 0);

  function open(thread) {
    window.location.hash = conversationHash(thread.type, thread.proposalId);
    setSelectedKey(`${thread.type}:${thread.proposalId}`);
  }

  return <section className="exchange-inbox">
    <header className="exchange-inbox-header">
      <div><span>Entre compañeros</span><h1>Conversaciones</h1>
        <p>Tus propuestas de descansos y vacaciones en un solo lugar.</p></div>
      {unreadCount > 0 && <b className="exchange-inbox-unread">{unreadCount} sin leer</b>}
    </header>
    {EXCHANGE_PREVIEW_READ_ONLY && <p className="exchange-inbox-preview-note">Vista previa en modo consulta: puedes revisar las conversaciones, pero los mensajes nuevos están desactivados para proteger producción.</p>}
    <div className="exchange-inbox-shell">
      <aside className={`exchange-inbox-list${selected ? " has-selection" : ""}`} aria-label="Lista de conversaciones">
        <div className="exchange-inbox-filters">
          <button type="button" className={filter === "active" ? "is-active" : ""}
            onClick={() => setFilter("active")}>En curso <span>{activeCount}</span></button>
          <button type="button" className={filter === "archived" ? "is-active" : ""}
            onClick={() => setFilter("archived")}>Histórico <span>{archivedCount}</span></button>
        </div>
        <div className="exchange-inbox-types" aria-label="Filtrar conversaciones">
          {[["all", "Todas"], ["rest", "Descansos"], ["vacation", "Vacaciones"]].map(([value, label]) =>
            <button key={value} type="button" className={typeFilter === value ? "is-active" : ""}
              onClick={() => setTypeFilter(value)}>{label}</button>)}
        </div>
        {loading ? <p className="exchange-inbox-empty">Cargando conversaciones…</p>
          : error ? <p className="exchange-inbox-error" role="alert">{error}</p>
            : visible.length ? <div className="exchange-inbox-rows">
              {visible.map((thread) => <button type="button" key={`${thread.type}:${thread.proposalId}`}
                className={`exchange-inbox-row${selectedKey === `${thread.type}:${thread.proposalId}` ? " is-selected" : ""}`}
                onClick={() => open(thread)}>
                <span className={`exchange-inbox-avatar is-${thread.type}`}>
                  {thread.type === "rest" ? <CalendarDays size={20} /> : <Sun size={20} />}</span>
                <span className="exchange-inbox-row-copy">
                  <span className="exchange-inbox-row-top"><strong>{thread.counterpartName}{thread.counterpartChapa ? ` · ${thread.counterpartChapa}` : ""}</strong>
                    <small>{formatWhen(thread.lastAt)}</small></span>
                  <small>{thread.type === "rest" ? "Descanso" : "Vacaciones"} · {threadStatus(thread)}</small>
                  <span className="exchange-inbox-preview">{thread.lastMessage || "Propuesta creada. Puedes iniciar la conversación."}</span>
                </span>
                {Number(thread.unread) > 0 && <b className="exchange-inbox-count">{thread.unread}</b>}
              </button>)}
            </div> : <div className="exchange-inbox-empty"><Inbox size={30} />
              <strong>{filter === "active" ? "No tienes conversaciones en curso" : "Todavía no hay historial"}</strong>
              <span>Las conversaciones aparecerán aquí cuando participes en una propuesta.</span></div>}
      </aside>
      <div className={`exchange-inbox-detail${selected ? " has-selection" : ""}`}>
        {selected ? <>
          <div className="exchange-inbox-detail-head">
            <button type="button" className="exchange-inbox-back" aria-label="Volver a conversaciones"
              onClick={() => { window.location.hash = "#/conversaciones"; setSelectedKey(""); }}><ArrowLeft size={19} /></button>
            <span className={`exchange-inbox-avatar is-${selected.type}`}>
              {selected.type === "rest" ? <CalendarDays size={20} /> : <Sun size={20} />}</span>
            <div><strong>{selected.counterpartName}{selected.counterpartChapa ? ` · ${selected.counterpartChapa}` : ""}</strong>
              <small>{selected.type === "rest" ? "Descanso" : "Vacaciones"} · {threadStatus(selected)}</small></div>
          </div>
          <div className="exchange-inbox-context">
            <span><small>Tengo</small><strong>{formatRange(selected.offered, selected.offeredEnd) || "—"}</strong></span>
            <span><small>Quiero</small><strong>{formatRange(selected.wanted, selected.wantedEnd) || "—"}</strong></span>
          </div>
          <PrivateExchangeChat key={selectedKey} token={session.token} type={selected.type}
            proposalId={selected.proposalId} canWrite={isActive(selected) && !EXCHANGE_PREVIEW_READ_ONLY} compact
            ownChapa={session.chapa} counterpartChapa={selected.counterpartChapa}
            onActivity={() => reload({ quiet: true })} />
          {!isActive(selected) && <p className="exchange-inbox-readonly">Esta conversación es parte de tu historial y ya no admite mensajes nuevos.</p>}
        </> : <div className="exchange-inbox-placeholder"><MessageCircle size={36} />
          <strong>Elige una conversación</strong><span>Tu historial queda aquí aunque se retire una oferta.</span></div>}
      </div>
    </div>
  </section>;
}
