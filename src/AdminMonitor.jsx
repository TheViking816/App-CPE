import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, Clock3, Eye, RefreshCw, Search, ShieldCheck, UserRoundCheck, UsersRound } from "lucide-react";
import { getUsageMonitor } from "./supabaseClient.js";

const PAGE_LABELS = {
  inicio: "Inicio", contratacion: "Contratación", sueldometro: "Sueldómetro",
  descansos: "Descansos", vacaciones: "Vacaciones", nominas: "Nóminas",
  excepciones: "Excepciones",
  estado: "Estado operativo", puertas: "Puertas", censo: "Censo", portal: "Portal",
  tablon: "Tablón general", enlaces: "Enlaces"
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

  const load = async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      setData(await getUsageMonitor({ token: session.token }));
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
        </>
      )}
    </section>
  );
}
