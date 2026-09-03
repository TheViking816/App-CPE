import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, CheckSquare2, Clock3, Eye, ListRestart, Play, RefreshCw, Search, ShieldCheck, UserRoundCheck, UsersRound } from "lucide-react";
import { getAdminPortalSyncUsers, getAdminWorkerControlStatus, getUsageMonitor, queueAdminPortalSyncUsers, requestPendingWorkerRun } from "./supabaseClient.js";

const PAGE_LABELS = {
  inicio: "Inicio", contratacion: "Contratación", sueldometro: "Sueldómetro",
  descansos: "Descansos", vacaciones: "Vacaciones", nominas: "Nóminas",
  excepciones: "Excepciones",
  estado: "Estado operativo", puertas: "Puertas", censo: "Censo", portal: "Portal",
  tablon: "Tablón general", enlaces: "Enlaces", foro: "Foro"
};

const EVENT_LABELS = {
  app_open: "Abre la app", login: "Inicia sesión", support_login: "Acceso de soporte",
  register: "Se registra", specialties_update: "Actualiza especialidades",
  password_change: "Cambia la contraseña", portal_open: "Abre Portal",
  tablon_general_open: "Abre el tablón", page_visit: "Visita una página"
};

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(date);
}

function Stat({ icon: Icon, label, value, detail, tone }) {
  return (
    <article className={`monitor-stat monitor-stat-${tone}`}>
      <span><Icon size={21} /></span>
      <div><small>{label}</small><strong>{value ?? 0}</strong><p>{detail}</p></div>
    </article>
  );
}

export default function AdminMonitor({ session }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [pageFilter, setPageFilter] = useState("");
  const [portalUsers, setPortalUsers] = useState([]);
  const [portalQuery, setPortalQuery] = useState("");
  const [portalFilter, setPortalFilter] = useState("all");
  const [selectedChapas, setSelectedChapas] = useState(() => new Set());
  const [queueing, setQueueing] = useState(false);
  const [queueMessage, setQueueMessage] = useState("");
  const [portalError, setPortalError] = useState("");
  const [workerControl, setWorkerControl] = useState(null);
  const [startingWorker, setStartingWorker] = useState(false);

  const load = async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    setPortalError("");
    try {
      const [usageResult, portalResult, workerResult] = await Promise.allSettled([
        getUsageMonitor({ token: session.token }),
        getAdminPortalSyncUsers({ token: session.token }),
        getAdminWorkerControlStatus({ token: session.token })
      ]);
      if (usageResult.status === "rejected") throw usageResult.reason;
      setData(usageResult.value);
      if (portalResult.status === "fulfilled") {
        setPortalUsers(portalResult.value?.users || []);
        setSelectedChapas((current) => new Set([...current].filter((chapa) => (portalResult.value?.users || []).some((user) => user.chapa === chapa))));
      } else {
        setPortalError(portalResult.reason?.message || "No se pudieron cargar las sincronizaciones.");
      }
      if (workerResult.status === "fulfilled") setWorkerControl(workerResult.value);
    } catch (requestError) {
      setError(requestError?.message || "No se pudo cargar el monitor.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ quiet: true }), 60_000);
    return () => window.clearInterval(timer);
  }, [session.token]);

  useEffect(() => {
    const refreshWorkerControl = async () => {
      try {
        setWorkerControl(await getAdminWorkerControlStatus({ token: session.token }));
      } catch {
        // El resto del monitor sigue disponible si falla un latido puntual.
      }
    };
    const timer = window.setInterval(refreshWorkerControl, 10_000);
    return () => window.clearInterval(timer);
  }, [session.token]);

  const filteredUsers = useMemo(() => {
    const normalized = query.replace(/\D/g, "");
    return (data?.users || []).filter((user) => {
      const matchesUser = !normalized || String(user.chapa || "").includes(normalized);
      const matchesPage = !pageFilter || user.lastPage === pageFilter;
      return matchesUser && matchesPage;
    });
  }, [data?.users, pageFilter, query]);

  const maxViews = Math.max(1, ...(data?.hourly || []).map((item) => Number(item.views) || 0));
  const maxPageViews = Math.max(1, ...(data?.pages || []).map((item) => Number(item.views) || 0));
  const summary = data?.summary || {};
  const filteredPortalUsers = useMemo(() => {
    const normalized = portalQuery.replace(/\D/g, "");
    return portalUsers.filter((user) => {
      if (normalized && !String(user.chapa || "").includes(normalized)) return false;
      if (portalFilter === "pending") return user.activationStatus === "pending";
      if (portalFilter === "failed") return user.jobStatus === "failed";
      if (portalFilter === "queued") return ["queued", "running"].includes(user.jobStatus);
      if (portalFilter === "paused") return user.syncStatus === "paused_inactive";
      if (portalFilter === "history") return !user.hasPremiumHistory;
      if (portalFilter === "attention") return user.activationStatus === "pending" || user.syncStatus === "paused_inactive" || user.jobStatus === "failed" || !user.hasPremiumHistory;
      return true;
    });
  }, [portalFilter, portalQuery, portalUsers]);
  const canSelectPortalUser = (user) => user.hasCredentials && user.syncStatus !== "paused_inactive" && !["queued", "running"].includes(user.jobStatus);
  const selectableFilteredChapas = filteredPortalUsers.filter(canSelectPortalUser).map((user) => user.chapa);
  const allFilteredSelected = selectableFilteredChapas.length > 0 && selectableFilteredChapas.every((chapa) => selectedChapas.has(chapa));

  const togglePortalUser = (chapa) => {
    setQueueMessage("");
    setSelectedChapas((current) => {
      const next = new Set(current);
      if (next.has(chapa)) next.delete(chapa);
      else next.add(chapa);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setQueueMessage("");
    setSelectedChapas((current) => {
      const next = new Set(current);
      if (allFilteredSelected) selectableFilteredChapas.forEach((chapa) => next.delete(chapa));
      else selectableFilteredChapas.forEach((chapa) => next.add(chapa));
      return next;
    });
  };

  const queueSelected = async ({ fullHistory = false } = {}) => {
    const chapas = [...selectedChapas];
    if (!chapas.length) return;
    setQueueing(true);
    setQueueMessage("");
    setPortalError("");
    try {
      const result = await queueAdminPortalSyncUsers({ token: session.token, chapas, fullHistory });
      const queued = Number(result?.queued || 0);
      const skipped = Number(result?.skipped || 0);
      setQueueMessage(`${queued} ${queued === 1 ? "chapa añadida" : "chapas añadidas"} a la cola para ${fullHistory ? "la carga inicial completa" : "la actualización normal"}${skipped ? ` · ${skipped} omitidas` : ""}. Ya puedes ejecutar los pendientes desde el botón del monitor.`);
      setSelectedChapas(new Set());
      const refreshed = await getAdminPortalSyncUsers({ token: session.token });
      setPortalUsers(refreshed?.users || []);
    } catch (requestError) {
      setPortalError(requestError?.message || "No se pudieron encolar las chapas seleccionadas.");
    } finally {
      setQueueing(false);
    }
  };

  const runPendingWorker = async () => {
    setStartingWorker(true);
    setQueueMessage("");
    setPortalError("");
    try {
      await requestPendingWorkerRun({ token: session.token });
      setQueueMessage("Orden enviada al PC. Chrome se abrirá y comenzará a procesar la cola.");
      const status = await getAdminWorkerControlStatus({ token: session.token });
      setWorkerControl(status);
    } catch (requestError) {
      setPortalError(requestError?.message || "No se pudo enviar la orden al PC.");
    } finally {
      setStartingWorker(false);
    }
  };

  return (
    <section className="page-panel admin-monitor">
      <header className="monitor-hero">
        <div>
          <span className="monitor-eyebrow"><ShieldCheck size={16} /> Panel privado · Chapa 72683</span>
          <h1>Monitor de actividad</h1>
          <p>Usuarios, navegación y accesos de App CPE durante las últimas 24 horas.</p>
        </div>
        <button type="button" onClick={() => load({ quiet: true })} disabled={refreshing || loading}>
          <RefreshCw className={refreshing ? "is-spinning" : ""} size={18} />
          {refreshing ? "Actualizando" : "Actualizar"}
        </button>
      </header>

      <div className="monitor-retention-note">
        <Clock3 size={17} />
        <span><strong>Retención automática de 24 h.</strong> La limpieza se ejecuta cada hora; el panel se refresca cada minuto.</span>
        {data?.generatedAt && <time>Actualizado {formatTime(data.generatedAt)}</time>}
      </div>

      {loading ? (
        <div className="monitor-state"><RefreshCw className="is-spinning" size={28} /><strong>Cargando actividad…</strong></div>
      ) : error ? (
        <div className="monitor-state is-error"><strong>No se pudo abrir el monitor</strong><span>{error}</span><button type="button" onClick={() => load()}>Reintentar</button></div>
      ) : (
        <>
          <div className="monitor-stats">
            <Stat icon={UsersRound} label="Usuarios distintos" value={summary.uniqueUsers} detail="Con actividad en 24 h" tone="blue" />
            <Stat icon={UserRoundCheck} label="Activos ahora" value={summary.activeNow} detail="Últimos 15 minutos" tone="green" />
            <Stat icon={Eye} label="Páginas vistas" value={summary.pageViews} detail={`Pico ${summary.peakHourlyViews || 0} en una hora`} tone="violet" />
            <Stat icon={Activity} label="Aperturas" value={summary.appOpens} detail={`${summary.logins || 0} inicios de sesión`} tone="amber" />
          </div>

          <div className="monitor-grid monitor-grid-main">
            <article className="monitor-card monitor-activity-card">
              <div className="monitor-card-heading"><div><small>Ritmo de uso</small><h2>Actividad por hora</h2></div><BarChart3 size={21} /></div>
              <div className="monitor-chart" role="img" aria-label="Visitas por hora durante las últimas 24 horas">
                {(data?.hourly || []).map((item, index) => (
                  <div className="monitor-chart-column" key={item.at} title={`${formatTime(item.at)} · ${item.views} visitas · ${item.users} usuarios`}>
                    <span className="monitor-chart-users" style={{ bottom: `${Math.max(4, (Number(item.users) / Math.max(1, summary.peakHourlyUsers || 1)) * 82)}%` }} />
                    <i style={{ height: `${Math.max(3, (Number(item.views) / maxViews) * 100)}%` }} />
                    <small>{index % 3 === 0 ? formatTime(item.at) : ""}</small>
                  </div>
                ))}
              </div>
              <div className="monitor-chart-legend"><span><i /> Visitas</span><span><b /> Usuarios distintos</span><strong>Pico: {summary.peakHourlyUsers || 0} usuarios/h</strong></div>
            </article>

            <article className="monitor-card">
              <div className="monitor-card-heading"><div><small>Distribución</small><h2>Páginas más vistas</h2></div><Eye size={21} /></div>
              <div className="monitor-page-list">
                {(data?.pages || []).map((page, index) => (
                  <button type="button" key={page.page} onClick={() => setPageFilter(pageFilter === page.page ? "" : page.page)} className={pageFilter === page.page ? "active" : ""}>
                    <b>{index + 1}</b>
                    <span><strong>{PAGE_LABELS[page.page] || page.page}</strong><i><em style={{ width: `${(Number(page.views) / maxPageViews) * 100}%` }} /></i></span>
                    <small>{page.views}<em>{page.users} usr.</em></small>
                  </button>
                ))}
                {!data?.pages?.length && <p className="monitor-empty">Todavía no hay visitas registradas.</p>}
              </div>
            </article>
          </div>

          <article className="monitor-card monitor-users-card">
            <div className="monitor-card-heading monitor-users-heading">
              <div><small>Detalle en vivo</small><h2>Usuarios recientes <span>{filteredUsers.length}</span></h2></div>
              <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} inputMode="numeric" placeholder="Buscar chapa" /></label>
            </div>
            {pageFilter && <button className="monitor-filter-chip" type="button" onClick={() => setPageFilter("")}>Página: {PAGE_LABELS[pageFilter] || pageFilter} ×</button>}
            <div className="monitor-table-wrap">
              <table className="monitor-table">
                <thead><tr><th>Estado</th><th>Chapa</th><th>Última página</th><th>Visitas</th><th>Eventos</th><th>Última actividad</th></tr></thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.chapa}>
                      <td><span className={user.active ? "monitor-live is-active" : "monitor-live"}>{user.active ? "Activo" : "Reciente"}</span></td>
                      <td><strong>{user.chapa}</strong></td><td>{PAGE_LABELS[user.lastPage] || user.lastPage || "—"}</td>
                      <td>{user.views}</td><td>{user.events}</td><td>{formatDateTime(user.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredUsers.length && <p className="monitor-empty">No hay usuarios que coincidan con el filtro.</p>}
            </div>
          </article>

          <article className="monitor-card monitor-recent-card">
            <div className="monitor-card-heading"><div><small>Últimos movimientos</small><h2>Actividad reciente</h2></div><Activity size={21} /></div>
            <div className="monitor-timeline">
              {(data?.recent || []).slice(0, 30).map((event) => (
                <div key={event.id}><span className={event.type === "page_visit" ? "is-page" : ""} /><strong>{event.chapa || "Anónimo"}</strong><p>{event.type === "page_visit" ? `Visita ${PAGE_LABELS[event.page] || event.page}` : (EVENT_LABELS[event.type] || event.type)}</p><time>{formatDateTime(event.at)}</time></div>
              ))}
            </div>
          </article>

          <article className="monitor-card monitor-sync-card">
            <div className="monitor-card-heading monitor-sync-heading">
              <div><small>Control manual</small><h2>Sincronizar usuarios concretos <span>{selectedChapas.size} seleccionados</span></h2></div>
              <ListRestart size={22} />
            </div>
            <p className="monitor-sync-help">La actualización normal renueva el mes actual. La carga inicial completa recupera todo el año de jornales y primas y guarda las nóminas de los últimos 12 meses. Después puedes ejecutar la cola en el PC directamente desde este monitor.</p>
            <div className="monitor-sync-actions monitor-worker-actions">
              <span>
                <strong>{workerControl?.pcOnline ? "PC conectado" : "PC sin conexión"}</strong>
                {workerControl?.pcOnline
                  ? ` · ${workerControl.pcStatus === "executing" ? "Procesando pendientes" : "Preparado"}`
                  : workerControl?.lastSeenAt ? ` · Última conexión ${formatDateTime(workerControl.lastSeenAt)}` : " · Aún no se ha conectado el agente"}
              </span>
              <button type="button" onClick={runPendingWorker} disabled={startingWorker || ["queued", "claimed"].includes(workerControl?.commandStatus)}>
                <Play size={17} />
                {startingWorker ? "Enviando…" : workerControl?.commandStatus === "queued" ? "Esperando al PC" : workerControl?.commandStatus === "claimed" ? "Ejecutando en el PC" : "Ejecutar pendientes en el PC"}
              </button>
            </div>
            <div className="monitor-sync-toolbar">
              <label><Search size={17} /><input value={portalQuery} onChange={(event) => setPortalQuery(event.target.value)} inputMode="numeric" placeholder="Buscar chapa" /></label>
              <div className="monitor-sync-filters" role="group" aria-label="Filtrar sincronizaciones">
                {[["attention", "Necesitan atención"], ["paused", "En pausa"], ["history", "Sin histórico"], ["pending", "Pendientes"], ["failed", "Fallidas"], ["queued", "En cola"], ["all", "Todas"]].map(([value, label]) => (
                  <button key={value} type="button" className={portalFilter === value ? "is-active" : ""} onClick={() => setPortalFilter(value)}>{label}</button>
                ))}
              </div>
            </div>
            {portalError && <p className="monitor-sync-message is-error">{portalError}</p>}
            {queueMessage && <p className="monitor-sync-message is-success">{queueMessage}</p>}
            <div className="monitor-table-wrap">
              <table className="monitor-table monitor-sync-table">
                <thead><tr><th><button type="button" className="monitor-check-all" onClick={toggleAllFiltered} disabled={!selectableFilteredChapas.length} aria-label="Seleccionar resultados"><CheckSquare2 size={17} />{allFilteredSelected ? "Quitar" : "Todos"}</button></th><th>Chapa</th><th>Cuenta</th><th>Trabajo</th><th>Último intento</th><th>Detalle</th></tr></thead>
                <tbody>
                  {filteredPortalUsers.map((user) => {
                    const selectable = canSelectPortalUser(user);
                    const state = user.jobStatus || (user.hasCredentials ? "sin trabajo" : "sin claves");
                    return (
                      <tr key={user.chapa} className={selectedChapas.has(user.chapa) ? "is-selected" : ""}>
                        <td><input type="checkbox" checked={selectedChapas.has(user.chapa)} disabled={!selectable} onChange={() => togglePortalUser(user.chapa)} aria-label={`Seleccionar chapa ${user.chapa}`} /></td>
                        <td><strong>{user.chapa}</strong>{user.email && <small className="monitor-sync-email">{user.email}</small>}</td>
                        <td><span className={`monitor-job-state is-${user.syncStatus === "paused_inactive" ? "paused" : user.activationStatus}`}>{user.syncStatus === "paused_inactive" ? "En pausa" : user.activationStatus === "pending" ? "Pendiente" : "Activa"}</span>{user.syncStatus === "paused_inactive" && <small className="monitor-sync-email">Sin uso desde {formatDateTime(user.lastAppSeenAt)}</small>}</td>
                        <td><span className={`monitor-job-state is-${String(state).replace(/\s/g, "-")}`}>{state === "queued" ? "En cola" : state === "running" ? "Ejecutando" : state === "failed" ? "Fallida" : state === "completed" ? "Completada" : state}</span></td>
                        <td>{formatDateTime(user.requestedAt || user.lastSuccessAt)}</td>
                        <td className="monitor-sync-detail">{!user.hasPremiumHistory ? "Sin histórico de primas · usa Carga inicial completa" : user.jobMessage || (!user.hasCredentials ? "Debe configurar el acceso" : user.hasSecurityKey ? `${user.premiumHistoryMonths || 0} meses de primas guardados` : "Sin clave de nóminas")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!filteredPortalUsers.length && <p className="monitor-empty">No hay usuarios que coincidan con este filtro.</p>}
            </div>
            <div className="monitor-sync-actions">
              <span>{selectedChapas.size ? `${selectedChapas.size} ${selectedChapas.size === 1 ? "usuario seleccionado" : "usuarios seleccionados"}` : "Selecciona las chapas que quieras actualizar"}</span>
              <button type="button" onClick={() => queueSelected({ fullHistory: false })} disabled={!selectedChapas.size || queueing}><Play size={17} />{queueing ? "Añadiendo…" : "Actualizar mes actual"}</button>
              <button type="button" onClick={() => queueSelected({ fullHistory: true })} disabled={!selectedChapas.size || queueing}><ListRestart size={17} />{queueing ? "Añadiendo…" : "Carga inicial completa"}</button>
            </div>
          </article>
        </>
      )}
    </section>
  );
}
