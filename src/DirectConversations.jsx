import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, CheckCheck, MessageCircle, Search, Trash2, UsersRound } from "lucide-react";
import { EXCHANGE_PREVIEW_READ_ONLY } from "./exchangePreview.js";
import {
  deleteDirectConversation, getDirectDirectory, getDirectMessages, getDirectThreads, markDirectRead,
  sendDirectMessage, startDirectConversation
} from "./supabaseClient.js";

function when(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("es-ES", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

export default function DirectConversations({ session }) {
  const [people, setPeople] = useState([]);
  const [threads, setThreads] = useState([]);
  const [listMode, setListMode] = useState("people");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [nextPeople, nextThreads] = await Promise.all([
        getDirectDirectory({ token: session.token }),
        getDirectThreads({ token: session.token })
      ]);
      setPeople(nextPeople);
      setThreads(nextThreads);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "No se pudo cargar la lista de compañeros.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [session.token, session.supportAccess]);

  useEffect(() => {
    reload();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") reload({ quiet: true });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const loadMessages = useCallback(async () => {
    if (!selectedId) return;
    try {
      const next = await getDirectMessages({ token: session.token, conversationId: selectedId });
      setMessages(next);
      if (!session.supportAccess) await markDirectRead({ token: session.token, conversationId: selectedId });
      reload({ quiet: true });
    } catch (loadError) {
      setError(loadError.message || "No se pudo cargar la conversación.");
    }
  }, [selectedId, session.token, session.supportAccess, reload]);

  useEffect(() => {
    setMessages([]);
    if (!selectedId) return undefined;
    loadMessages();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadMessages();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [selectedId, loadMessages]);

  const selected = threads.find((thread) => thread.id === selectedId)
    || (selectedPerson?.id === selectedId ? selectedPerson : null);
  const normalizedSearch = search.trim().toLocaleLowerCase("es-ES");
  const filteredPeople = useMemo(() => people.filter((person) =>
    !normalizedSearch || `${person.name} ${person.chapa}`.toLocaleLowerCase("es-ES").includes(normalizedSearch)
  ).sort((a, b) => Number(Boolean(b.isAdmin)) - Number(Boolean(a.isAdmin))), [people, normalizedSearch]);
  const filteredThreads = useMemo(() => threads.filter((thread) =>
    !normalizedSearch || `${thread.counterpartName} ${thread.counterpartChapa}`
      .toLocaleLowerCase("es-ES").includes(normalizedSearch)
  ), [threads, normalizedSearch]);
  const onlineCount = people.filter((person) => person.online && !person.isAdmin).length;

  async function openPerson(person) {
    if (busy) return;
    const existing = threads.find((thread) => thread.counterpartChapa === person.chapa);
    if (existing) {
      setSelectedId(existing.id);
      setSelectedPerson(null);
      setListMode("threads");
      return;
    }
    if (session.supportAccess) return;
    if (EXCHANGE_PREVIEW_READ_ONLY) return;
    setBusy(true);
    try {
      const id = await startDirectConversation({ token: session.token, chapa: person.chapa });
      await reload({ quiet: true });
      setSelectedId(id);
      setSelectedPerson({ id, counterpartName: person.name,
        counterpartChapa: person.chapa, online: person.online, isAdmin: person.isAdmin });
      setListMode("threads");
      setError("");
    } catch (startError) {
      setError(startError.message || "No se pudo iniciar el chat.");
    } finally {
      setBusy(false);
    }
  }

  async function send(event) {
    event.preventDefault();
    const message = body.trim();
    if (!message || !selectedId || busy || session.supportAccess || EXCHANGE_PREVIEW_READ_ONLY) return;
    setBusy(true);
    try {
      await sendDirectMessage({ token: session.token, conversationId: selectedId, body: message });
      setBody("");
      await loadMessages();
      setError("");
    } catch (sendError) {
      setError(sendError.message || "No se pudo enviar el mensaje.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!selectedId || busy || session.supportAccess || EXCHANGE_PREVIEW_READ_ONLY) return;
    if (!window.confirm("¿Eliminar este chat de tu lista? La otra persona conservará sus mensajes.")) return;
    setBusy(true);
    try {
      await deleteDirectConversation({ token: session.token, conversationId: selectedId });
      setSelectedId("");
      setSelectedPerson(null);
      setMessages([]);
      await reload({ quiet: true });
      setError("");
    } catch (deleteError) {
      setError(deleteError.message || "No se pudo eliminar el chat.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="exchange-inbox-shell direct-inbox-shell">
    <aside className={`exchange-inbox-list${selected ? " has-selection" : ""}`} aria-label="Compañeros y chats">
      <div className="exchange-inbox-filters">
        <button type="button" className={listMode === "people" ? "is-active" : ""}
          onClick={() => setListMode("people")}>Usuarios <span>{people.length}</span></button>
        <button type="button" className={listMode === "threads" ? "is-active" : ""}
          onClick={() => setListMode("threads")}>{session.supportAccess ? "Chats" : "Mis chats"} <span>{threads.length}</span></button>
      </div>
      <label className="direct-inbox-search"><Search size={17} />
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar nombre o chapa" aria-label="Buscar compañero" />
      </label>
      <p className="direct-inbox-online-count">{onlineCount} en línea en los últimos 15 minutos</p>
      {session.supportAccess && <p className="direct-inbox-online-count">Modo soporte · Chats de la chapa {session.chapa} · Solo lectura</p>}
      {loading ? <p className="exchange-inbox-empty">Cargando compañeros…</p>
        : listMode === "people" ? filteredPeople.length ? <div className="exchange-inbox-rows">
          {filteredPeople.map((person) => <button type="button" key={person.chapa}
            className={`exchange-inbox-row${selected?.counterpartChapa === person.chapa ? " is-selected" : ""}`}
            onClick={() => openPerson(person)}
            disabled={busy || (session.supportAccess && !threads.some((thread) => thread.counterpartChapa === person.chapa))}>
            <span className="exchange-inbox-avatar"><UsersRound size={19} /></span>
            <span className="exchange-inbox-row-copy"><strong>{person.name} · {person.chapa}</strong>
              {person.isAdmin ? <small className="direct-admin-badge">Admin</small>
                : <small className={person.online ? "direct-online" : ""}>
                  <i className="direct-status-dot" />{person.online ? "En línea" : "Desconectado"}</small>}</span>
          </button>)}
        </div> : <div className="exchange-inbox-empty">No hay compañeros que coincidan con la búsqueda.</div>
          : filteredThreads.length ? <div className="exchange-inbox-rows">
            {filteredThreads.map((thread) => <button type="button" key={thread.id}
              className={`exchange-inbox-row${selectedId === thread.id ? " is-selected" : ""}`}
              onClick={() => { setSelectedPerson(null); setSelectedId(thread.id); }}>
              <span className="exchange-inbox-avatar"><MessageCircle size={19} /></span>
              <span className="exchange-inbox-row-copy">
                <span className="exchange-inbox-row-top"><strong>{thread.counterpartName} · {thread.counterpartChapa}</strong>
                  <small>{when(thread.lastAt)}</small></span>
                {thread.isAdmin ? <small className="direct-admin-badge">Admin</small>
                  : <small className={thread.online ? "direct-online" : ""}>
                    <i className="direct-status-dot" />{thread.online ? "En línea" : "Desconectado"}</small>}
                <span className="exchange-inbox-preview">{thread.lastMessage || "Aún no hay mensajes"}</span>
              </span>
              {!session.supportAccess && Number(thread.unread) > 0 && <b className="exchange-inbox-count">{thread.unread}</b>}
            </button>)}
          </div> : <div className="exchange-inbox-empty"><MessageCircle size={30} />
            <strong>Aún no tienes chats</strong><span>Elige una persona para iniciar uno.</span></div>}
    </aside>
    <div className={`exchange-inbox-detail${selected ? " has-selection" : ""}`}>
      {selected ? <>
        <div className="exchange-inbox-detail-head">
          <button type="button" className="exchange-inbox-back" aria-label="Volver a la lista"
            onClick={() => { setSelectedId(""); setSelectedPerson(null); }}><ArrowLeft size={19} /></button>
          <span className="exchange-inbox-avatar"><MessageCircle size={19} /></span>
          <div><strong>{selected.counterpartName} · {selected.counterpartChapa}</strong>
            {selected.isAdmin ? <small className="direct-admin-badge">Admin</small>
              : <small className={selected.online ? "direct-online" : ""}>
                <i className="direct-status-dot" />{selected.online ? "En línea" : "Desconectado"}</small>}</div>
          {!session.supportAccess && !EXCHANGE_PREVIEW_READ_ONLY && <button type="button" className="direct-inbox-delete"
            onClick={removeSelected} disabled={busy} title="Eliminar chat de mi lista">
            <Trash2 size={17} /><span>Eliminar</span></button>}
        </div>
        <div className="direct-inbox-messages" aria-live="polite">
          {messages.length ? messages.map((message) => <div key={message.id}
            className={`rest-exchange-message${message.isOwn ? " is-own" : ""}`}>
            <small>{message.isOwn
              ? `${session.supportAccess ? session.displayName || "Usuario" : "Tú"} · ${session.chapa}`
              : `${selected.counterpartName} · ${selected.counterpartChapa}`} · {when(message.createdAt)}</small>
            <span>{message.body}</span>
            {message.isOwn && <small className={`direct-message-receipt${message.readAt ? " is-read" : ""}`}
              title={message.readAt ? `Leído ${when(message.readAt)}` : "Enviado; aún no leído"}>
              {message.readAt ? <CheckCheck size={14} /> : <Check size={14} />}
              {message.readAt ? "Leído" : "Enviado"}
            </small>}
          </div>) : <p>{session.supportAccess ? "No hay mensajes en este chat." : "Aún no hay mensajes. Saluda a tu compañero."}</p>}
        </div>
        {!session.supportAccess && !EXCHANGE_PREVIEW_READ_ONLY && <form className="direct-inbox-compose" onSubmit={send}>
          <label htmlFor="direct-chat-message">Mensaje privado</label>
          <textarea id="direct-chat-message" value={body} maxLength={500} rows={2}
            onChange={(event) => setBody(event.target.value)} placeholder="Escribe un mensaje…" />
          <button type="submit" disabled={busy || !body.trim()}>{busy ? "Enviando…" : "Enviar"}</button>
        </form>}
      </> : <div className="exchange-inbox-placeholder"><MessageCircle size={36} />
        <strong>{session.supportAccess ? "Elige un chat" : "Elige a un compañero"}</strong>
        <span>{session.supportAccess
          ? "Puedes revisar los mensajes sin enviarlos ni marcarlos como leídos."
          : "Puedes iniciar un chat privado con cualquier usuario registrado."}</span>
      </div>}
    </div>
    {error && <p className="exchange-inbox-error" role="alert">{error}</p>}
  </div>;
}
