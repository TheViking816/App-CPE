import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  DoorOpen,
  Eye,
  EyeOff,
  Lock,
  LogOut,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserRound
} from "lucide-react";
import {
  censo,
  classifyDistance,
  findByChapa,
  getDoorState,
  normalizeDoor,
  specialty,
  validateCenso
} from "./censo.js";
import { getLatestDoorSnapshot } from "./supabaseClient.js";

const STORAGE_KEY = "app-cpe-session";

function getInitialSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

function formatDistance(value) {
  if (value === null) return "Sin dato";
  if (value === 0) return "En puerta";
  return `${value} puestos`;
}

function buildPasswordHash(value) {
  return btoa(unescape(encodeURIComponent(String(value || ""))));
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
      setError("Introduce un PIN local para bloquear esta sesión.");
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
    <form className="login-panel" onSubmit={submit}>
      <div className="panel-title">
        <span className="icon-box"><Lock size={18} /></span>
        <div>
          <h2>Acceso local</h2>
          <p>Entra con tu chapa del censo cargado.</p>
        </div>
      </div>

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
            placeholder="Solo se guarda en este navegador"
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
        Entrar <ArrowRight size={18} />
      </button>
    </form>
  );
}

function SyncPlan() {
  return (
    <section className="sync-card">
      <div className="panel-title compact">
        <span className="icon-box green"><RefreshCcw size={17} /></span>
        <div>
          <h2>Lectura automática</h2>
          <p>Puertas actualizables sin tocar el censo.</p>
        </div>
      </div>

      <div className="sync-list">
        <div>
          <strong>Opción más simple</strong>
          <span>Leer la pantalla pública de Puertas y actualizar solo la fila CONDUCTOR 1a.</span>
        </div>
        <div>
          <strong>Horarios</strong>
          <span>Programar lectura a las 07:15, 12:15 y 14:45, con margen de reintento.</span>
        </div>
        <div>
          <strong>Ventaja</strong>
          <span>Sin usuario ni contraseña si el enlace de Puertas sigue accesible.</span>
        </div>
      </div>
    </section>
  );
}

function Sidebar({ session, user, onLogout, onLogin }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">CPE</div>
        <div>
          <h1>App CPE</h1>
          <p>Puertas y censo de fijos</p>
        </div>
      </div>

      {session && user ? (
        <section className="profile-card">
          <div className="profile-main">
            <span className="avatar">{String(user.chapa).slice(-2)}</span>
            <div>
              <p>Chapa</p>
              <strong>{user.chapa}</strong>
            </div>
          </div>
          <div className="profile-stats">
            <span>Especialidad</span>
            <strong>{specialty.name}</strong>
            <span>Tu posición</span>
            <strong>{user.position} / {censo.length}</strong>
          </div>
          <button className="secondary-button" onClick={onLogout}>
            <LogOut size={17} /> Salir
          </button>
        </section>
      ) : (
        <LoginPanel onLogin={onLogin} />
      )}

      <SyncPlan />
    </aside>
  );
}

function DoorCard({ item }) {
  const tone = classifyDistance(item.distance);

  return (
    <article className={`door-card ${tone}`}>
      <div className="door-card-header">
        <span>{item.label}</span>
        <DoorOpen size={19} />
      </div>
      <strong>{item.raw}</strong>
      <dl>
        <div>
          <dt>Puerta</dt>
          <dd>{item.doorChapa}</dd>
        </div>
        <div>
          <dt>Posición</dt>
          <dd>{item.doorPosition || "-"}</dd>
        </div>
      </dl>
      <p>{formatDistance(item.distance)}</p>
    </article>
  );
}

function Summary({ user, doors }) {
  const nearest = doors
    .filter((item) => item.distance !== null)
    .sort((a, b) => a.distance - b.distance)[0];

  return (
    <section className="summary">
      <div>
        <p className="section-label">CONDUCTOR 1a</p>
        <h2>Distancia a puertas</h2>
        <p>
          Censo específico de {censo.length} chapas. Las puertas usan el prefijo del portal y se calculan por los cuatro últimos dígitos.
        </p>
      </div>
      <div className="summary-metrics">
        <div>
          <span>Tu posición</span>
          <strong>{user ? user.position : "-"}</strong>
        </div>
        <div>
          <span>Puerta más cercana</span>
          <strong>{nearest ? nearest.label : "-"}</strong>
        </div>
        <div>
          <span>Distancia mínima</span>
          <strong>{nearest ? formatDistance(nearest.distance) : "-"}</strong>
        </div>
      </div>
    </section>
  );
}

function CensoGrid({ user, doors, query, onQuery }) {
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
    <section className="censo-section">
      <div className="section-header">
        <div>
          <p className="section-label">Censo</p>
          <h2>{specialty.name}</h2>
        </div>
        <div className="search-field">
          <Search size={18} />
          <input
            inputMode="numeric"
            placeholder="Buscar chapa o posición"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="legend">
        <span><i className="legend-dot user" /> Tu chapa</span>
        <span><i className="legend-dot door" /> Puerta</span>
        <span><i className="legend-dot both" /> Coincidencia</span>
      </div>

      <div className="censo-grid" role="list">
        {filtered.map((item) => {
          const door = doorByChapa.get(item.chapa);
          const isUser = user?.chapa === item.chapa;
          const className = [
            "censo-cell",
            door ? "is-door" : "",
            isUser ? "is-user" : "",
            door && isUser ? "is-both" : ""
          ].filter(Boolean).join(" ");

          return (
            <div className={className} key={`${item.position}-${item.chapa}`} role="listitem">
              <span>{item.position}</span>
              <strong>{item.chapa}</strong>
              {door && <em>{door.label}</em>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Diagnostics() {
  const validation = validateCenso();

  return (
    <section className={`diagnostics ${validation.ok ? "ok" : "warn"}`}>
      <CheckCircle2 size={18} />
      <span>
        Censo cargado: {validation.count}/{validation.expected}
        {validation.duplicates.length > 0 ? ` · duplicados: ${validation.duplicates.join(", ")}` : ""}
      </span>
    </section>
  );
}

export function App() {
  const [session, setSession] = useState(getInitialSession);
  const [query, setQuery] = useState("");
  const [doorConfig, setDoorConfig] = useState(null);

  const user = session ? findByChapa(session.chapa) : null;
  const activeDoors = doorConfig?.doors || specialty.doors;
  const doors = useMemo(() => getDoorState(user?.chapa, activeDoors), [user?.chapa, activeDoors]);

  useEffect(() => {
    let cancelled = false;

    getLatestDoorSnapshot()
      .then((snapshot) => {
        if (snapshot) return snapshot;
        return fetch(`${import.meta.env.BASE_URL}data/puertas-conductor-1a.json`, { cache: "no-store" })
          .then((response) => {
            if (!response.ok) throw new Error("No hay fichero de puertas");
            return response.json();
          });
      })
      .then((response) => {
        const data = response;
        if (!cancelled && Array.isArray(data?.doors)) {
          setDoorConfig(data);
        }
      })
      .catch(() => {
        if (!cancelled) setDoorConfig(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  };

  return (
    <div className="app-shell">
      <Sidebar
        session={session}
        user={user}
        onLogout={logout}
        onLogin={setSession}
      />

      <main className="main-content">
        <header className="topbar">
          <div>
            <p>Especialidad activa</p>
            <h2>{specialty.name}</h2>
          </div>
          <div className="topbar-status">
            <ShieldCheck size={18} />
            <span>{doorConfig?.updatedAt ? `Puertas actualizadas ${new Date(doorConfig.updatedAt).toLocaleString("es-ES")}` : "Datos locales · sin credenciales del portal"}</span>
          </div>
        </header>

        <Diagnostics />
        <Summary user={user} doors={doors} />

        <section className="doors-section">
          <div className="section-header">
            <div>
              <p className="section-label">Puertas</p>
              <h2>Turnos del portal</h2>
            </div>
            <p className="door-note">
              Ejemplo: {activeDoors[0].raw} se lee como chapa {normalizeDoor(activeDoors[0].raw)}.
            </p>
          </div>
          <div className="doors-grid">
            {doors.map((item) => <DoorCard key={item.key} item={item} />)}
          </div>
        </section>

        <CensoGrid user={user} doors={doors} query={query} onQuery={setQuery} />
      </main>
    </div>
  );
}
