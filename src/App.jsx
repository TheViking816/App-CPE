import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ExternalLink,
  Eye,
  EyeOff,
  Home,
  Link as LinkIcon,
  Lock,
  LogOut,
  Search,
  UserRound,
  UsersRound
} from "lucide-react";
import {
  censo,
  classifyDistance,
  findByChapa,
  getDoorState,
  specialty,
  validateCenso
} from "./censo.js";
import { getLatestDoorSnapshot, requestDoorRefresh } from "./supabaseClient.js";

const STORAGE_KEY = "app-cpe-session";
const SNAPSHOT_POLL_MS = 60_000;

const NAV_ITEMS = [
  { id: "inicio", label: "Inicio", Icon: Home },
  { id: "puertas", label: "Puertas", Icon: CalendarDays },
  { id: "censo", label: "Censo", Icon: UsersRound },
  { id: "enlaces", label: "Enlaces", Icon: LinkIcon }
];

function getInitialSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

function buildPasswordHash(value) {
  return btoa(unescape(encodeURIComponent(String(value || ""))));
}

function formatDistance(value) {
  if (value === null) return "Sin dato";
  if (value === 0) return "En puerta";
  return `${value} puestos`;
}

function formatUpdatedAt(value) {
  if (!value) return "Sin actualizar";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin actualizar";

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function normalizeLegacyDoor(door) {
  const key = String(door.key || "").toUpperCase();
  if (key === "LAB" || key === "LAB-HOY") {
    return { ...door, key: "LAB", label: "Diurna", dayType: "laborable", shift: "LAB" };
  }
  if (key === "NOC" || key === "LAB-SUPER") {
    return { ...door, key: "NOC", label: "Super", dayType: "laborable", shift: "NOC" };
  }
  if (key === "NOC-FES" || key === "FES-SUPER") {
    return { ...door, key: "NOC-FES", label: "Super festiva", dayType: "festivo", shift: "NOC-FES" };
  }
  if (key === "FES" || key === "FES-DIURNO") {
    return { ...door, key: "FES", label: "Diurna festiva", dayType: "festivo", shift: "FES" };
  }
  return null;
}

function sanitizeDoors(doors) {
  const source = Array.isArray(doors) ? doors : specialty.doors;
  const byKey = new Map();

  for (const door of source) {
    const normalized = normalizeLegacyDoor(door);
    if (normalized) byKey.set(normalized.key, normalized);
  }

  return ["LAB", "NOC", "NOC-FES", "FES"]
    .map((key) => byKey.get(key))
    .filter(Boolean);
}

function getNearestDoor(doors) {
  return doors
    .filter((door) => door.distance !== null)
    .reduce((nearest, door) => {
      if (!nearest || door.distance < nearest.distance) return door;
      return nearest;
    }, null);
}

function LoginPanel({ onLogin }) {
  const [chapa, setChapa] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState("");

  const submit = (event) => {
    event.preventDefault();
    const user = findByChapa(chapa);

    if (!user) {
      setError("Esa chapa no aparece en CONDUCTOR 1a.");
      return;
    }

    if (!pin.trim()) {
      setError("Introduce un PIN local para esta sesion.");
      return;
    }

    const session = {
      chapa: user.chapa,
      pinHash: buildPasswordHash(pin),
      createdAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    onLogin(session);
  };

  return (
    <form className="login-card" onSubmit={submit}>
      <div className="login-logo">
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="App CPE" />
      </div>
      <h1>App CPE</h1>
      <p>Acceso para fijos de CONDUCTOR 1a.</p>

      <label>
        <span>Chapa</span>
        <div className="field">
          <UserRound size={18} />
          <input
            inputMode="numeric"
            placeholder="Ej. 2625"
            value={chapa}
            onChange={(event) => setChapa(event.target.value)}
          />
        </div>
      </label>

      <label>
        <span>PIN local</span>
        <div className="field">
          <Lock size={18} />
          <input
            type={showPin ? "text" : "password"}
            placeholder="Solo en este navegador"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
          />
          <button
            type="button"
            className="icon-button"
            onClick={() => setShowPin((value) => !value)}
            aria-label={showPin ? "Ocultar PIN" : "Mostrar PIN"}
          >
            {showPin ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </label>

      {error && <p className="form-error">{error}</p>}

      <button className="primary-button" type="submit">
        Entrar
      </button>
    </form>
  );
}

function AppHeader({ user, onLogout }) {
  return (
    <header className="app-header">
      <div className="logo-box">
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="App CPE" />
      </div>
      <div className="header-title">
        <strong>App CPE</strong>
        <span>{specialty.name}</span>
      </div>
      {user && (
        <button className="logout-button" type="button" onClick={onLogout}>
          <LogOut size={17} />
          Salir
        </button>
      )}
    </header>
  );
}

function HomePanel({ user, doors, doorConfig }) {
  const nearest = getNearestDoor(doors);
  const validation = validateCenso();
  const updatedLabel = formatUpdatedAt(doorConfig?.updatedAt);

  return (
    <section className="page-panel">
      <div className="home-summary">
        <p>Tu posicion</p>
        <h1>{user.position} / {censo.length}</h1>
        <span>Chapa {user.chapa}</span>
      </div>

      <div className="quick-grid">
        <article>
          <span>Puerta mas cercana</span>
          <strong>{nearest ? nearest.label : "-"}</strong>
          <small>{nearest ? `${nearest.shift} · ${formatDistance(nearest.distance)}` : "Sin dato"}</small>
        </article>
        <article>
          <span>Estado</span>
          <strong>{doorConfig?.updatedAt ? "Actualizado" : "Local"}</strong>
          <small>{updatedLabel}</small>
        </article>
        <article>
          <span>Censo</span>
          <strong>{validation.count}/{validation.expected}</strong>
          <small>{specialty.name}</small>
        </article>
      </div>

      <section className="compact-door-list" aria-label="Resumen de puertas">
        {doors.map((door) => (
          <div key={door.key}>
            <span>{door.shift}</span>
            <strong>{formatDistance(door.distance)}</strong>
            <small>{door.raw}</small>
          </div>
        ))}
      </section>
    </section>
  );
}

function DoorsTable({ title, doors, tone }) {
  return (
    <section className="doors-table-section">
      <h2>{title}</h2>
      <div className="doors-table-wrap">
        <table className="doors-table">
          <thead>
            <tr>
              <th>TIPO</th>
              <th>PUERTA</th>
              <th>POS.</th>
              <th>DIST.</th>
            </tr>
          </thead>
          <tbody>
            {doors.map((door) => (
              <tr key={door.key} className={classifyDistance(door.distance)}>
                <td>
                  <strong>{door.label}</strong>
                  <small>{door.shift}</small>
                </td>
                <td>
                  <span className={`door-badge ${tone}`}>{door.raw}</span>
                  <small>Chapa {door.doorChapa}</small>
                </td>
                <td>{door.doorPosition || "-"}</td>
                <td>{formatDistance(door.distance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DoorsPanel({ doors, doorConfig }) {
  const laborableDoors = doors.filter((door) => door.dayType === "laborable");
  const festivoDoors = doors.filter((door) => door.dayType === "festivo");

  return (
    <section className="page-panel">
      <div className="section-heading">
        <p>Puertas de turno</p>
        <h1>CONDUCTOR 1a</h1>
        <span>Actualizado: {formatUpdatedAt(doorConfig?.updatedAt)}</span>
      </div>
      <DoorsTable title="Laborables" doors={laborableDoors} tone="lab" />
      <DoorsTable title="Festivas" doors={festivoDoors} tone="fes" />
    </section>
  );
}

function CensoPanel({ user, doors }) {
  const [query, setQuery] = useState("");
  const doorByChapa = useMemo(() => {
    const map = new Map();
    for (const door of doors) {
      map.set(door.doorChapa, door);
    }
    return map;
  }, [doors]);

  const filtered = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return censo;
    return censo.filter((item) => String(item.chapa).includes(trimmed) || String(item.position).includes(trimmed));
  }, [query]);

  return (
    <section className="page-panel censo-section">
      <div className="section-title-row">
        <div>
          <p>Censo: {censo.length}</p>
          <h1>{specialty.name}</h1>
        </div>
        <div className="search-field">
          <Search size={17} />
          <input
            inputMode="numeric"
            placeholder="Buscar"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="legend">
        <span><i className="legend-dot user" /> Tu chapa</span>
        <span><i className="legend-dot door" /> Puerta</span>
      </div>

      <div className="censo-grid" role="list">
        {filtered.map((item) => {
          const door = doorByChapa.get(item.chapa);
          const isUser = user?.chapa === item.chapa;
          const className = [
            "censo-cell",
            door ? "is-door" : "",
            isUser ? "is-user" : ""
          ].filter(Boolean).join(" ");

          return (
            <div className={className} key={`${item.position}-${item.chapa}`} role="listitem">
              <span>{item.position}</span>
              <strong>{item.chapa}</strong>
              {door && <em>{door.shift}</em>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LinksPanel() {
  return (
    <section className="page-panel">
      <div className="section-heading">
        <p>Accesos rapidos</p>
        <h1>Enlaces utiles</h1>
      </div>
      <article className="empty-links">
        <ExternalLink size={24} />
        <strong>Preparado para enlaces</strong>
        <span>Cuando me pases los accesos, los dejare aqui ordenados.</span>
      </article>
    </section>
  );
}

function BottomNav({ activeTab, onChange }) {
  return (
    <nav className="bottom-nav" aria-label="Navegacion inferior">
      {NAV_ITEMS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={activeTab === id ? "active" : ""}
          onClick={() => onChange(id)}
        >
          <Icon size={23} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function App() {
  const [session, setSession] = useState(getInitialSession);
  const [doorConfig, setDoorConfig] = useState(null);
  const [activeTab, setActiveTab] = useState("inicio");

  const user = session ? findByChapa(session.chapa) : null;
  const activeDoors = sanitizeDoors(doorConfig?.doors);
  const doors = useMemo(() => getDoorState(user?.chapa, activeDoors), [user?.chapa, activeDoors]);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer = null;
    let pollTimer = null;

    async function loadLatestSnapshot() {
      const snapshot = await getLatestDoorSnapshot();
      if (snapshot) return snapshot;

      const response = await fetch(`${import.meta.env.BASE_URL}data/puertas-conductor-1a.json`, { cache: "no-store" });
      if (!response.ok) throw new Error("No hay fichero de puertas");
      return response.json();
    }

    async function applyLatestSnapshot() {
      const response = await loadLatestSnapshot();
      if (!cancelled && Array.isArray(response?.doors)) {
        setDoorConfig(response);
      }
      return response;
    }

    applyLatestSnapshot()
      .then((response) => {
        if (!Array.isArray(response?.doors)) return null;
        pollTimer = window.setInterval(() => {
          applyLatestSnapshot().catch(() => {});
        }, SNAPSHOT_POLL_MS);
        return requestDoorRefresh();
      })
      .then((refresh) => {
        if (!refresh?.triggered || cancelled) return;

        refreshTimer = window.setTimeout(() => {
          applyLatestSnapshot().catch(() => {});
        }, 90000);
      })
      .catch(() => {
        if (!cancelled) setDoorConfig(null);
      });

    return () => {
      cancelled = true;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshWhenVisible() {
      if (document.visibilityState !== "visible") return;
      const snapshot = await getLatestDoorSnapshot();
      if (!cancelled && Array.isArray(snapshot?.doors)) {
        setDoorConfig(snapshot);
      }
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setActiveTab("inicio");
  };

  if (!user) {
    return (
      <div className="login-screen">
        <LoginPanel onLogin={setSession} />
      </div>
    );
  }

  return (
    <div className="mobile-app">
      <AppHeader user={user} onLogout={logout} />
      <main className="content">
        {activeTab === "inicio" && <HomePanel user={user} doors={doors} doorConfig={doorConfig} />}
        {activeTab === "puertas" && <DoorsPanel doors={doors} doorConfig={doorConfig} />}
        {activeTab === "censo" && <CensoPanel user={user} doors={doors} />}
        {activeTab === "enlaces" && <LinksPanel />}
      </main>
      <BottomNav activeTab={activeTab} onChange={setActiveTab} />
    </div>
  );
}
