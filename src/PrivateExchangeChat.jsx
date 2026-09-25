import { useCallback, useEffect, useState } from "react";
import {
  getRestExchangeMessages, getVacationExchangeMessages,
  sendRestExchangeMessage, sendVacationExchangeMessage
} from "./supabaseClient.js";

export default function PrivateExchangeChat({ token, proposalId, canWrite, type = "rest", compact = false, ownChapa, counterpartChapa, onActivity }) {
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const fetchMessages = type === "vacation" ? getVacationExchangeMessages : getRestExchangeMessages;
      setMessages(await fetchMessages({ token, proposalId }));
      setError("");
    } catch (loadError) {
      setError(loadError.message || "No se pudo cargar la conversación.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [token, proposalId, type]);

  useEffect(() => {
    reload();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") reload({ quiet: true });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  async function send(event) {
    event.preventDefault();
    const message = body.trim();
    if (!message || sending) return;
    setSending(true);
    setError("");
    try {
      const sendMessage = type === "vacation" ? sendVacationExchangeMessage : sendRestExchangeMessage;
      await sendMessage({ token, proposalId, body: message });
      setBody("");
      await reload({ quiet: true });
      onActivity?.();
    } catch (sendError) {
      setError(sendError.message || "No se pudo enviar el mensaje.");
    } finally {
      setSending(false);
    }
  }

  return <section className="rest-exchange-chat" aria-label="Conversación privada de la propuesta">
    {!compact && <><strong>Conversación privada</strong>
      <p>Solo tú y el otro participante podéis leer estos mensajes. El acuerdo debe tramitarse después en el Portal SEVASA.</p></>}
    {loading ? <span>Cargando mensajes…</span> : messages.length ? <div className="rest-exchange-messages" aria-live="polite">
      {messages.map((message) => <div key={message.id} className={`rest-exchange-message${message.isOwn ? " is-own" : ""}`}>
        <small>{message.isOwn ? "Tú" : message.senderName}{(message.isOwn ? ownChapa : counterpartChapa) ? ` · ${message.isOwn ? ownChapa : counterpartChapa}` : ""} · {new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</small>
        <span>{message.body}</span>
      </div>)}
    </div> : <span>Aún no hay mensajes. Puedes escribir para concretar los detalles.</span>}
    {error && <p className="rest-exchange-error" role="alert">{error}</p>}
    {canWrite && <form onSubmit={send}>
      <label htmlFor={`rest-message-${proposalId}`}>Mensaje</label>
      <textarea id={`rest-message-${proposalId}`} value={body} maxLength={500} rows={2}
        onChange={(event) => setBody(event.target.value)} placeholder="Escribe al compañero sobre esta propuesta…" />
      <button type="submit" disabled={sending || !body.trim()}>{sending ? "Enviando…" : "Enviar mensaje"}</button>
    </form>}
  </section>;
}
