import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Clipboard,
  ClipboardList,
  Eye,
  EyeOff,
  FileText,
  Home,
  Lock,
  LogOut,
  Mail,
  Menu,
  RefreshCcw,
  Search,
  Settings,
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

function buildPasswordHash(value) {
  return btoa(unescape(encodeURIComponent(String(value || ""))));
}

function formatDistance(value) {
  if (value === null) return "Sin dato";
  if (value === 0) return "En puerta";
  return `${value} puestos`;
}

function formatClock(date) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function sanitizeDoors(doors) {
  if (!Array.isArray(doors)) return specialty.doors;

  return doors
    .filter((door) => !String(door.key || "").toUpperCase().startsWith("POL"))
    .filter((door) => !String(door.label || "").toUpperCase().includes("POL"))
    .map((door) => {
      if (door.dayType) return door;
      if (door.key === "LAB") return { ...door, key: "LAB-HOY", label: "Lab Hoy", dayType: "laborable", turn: "Turno" };
      if (door.key === "NOC") return { ...door, key: "LAB-SUPER", label: "Super", dayType: "laborable", turn: "Turno" };
      if (door.key === "LAB-SIG") return { ...door, label: "Lab Sig. Dia", dayType: "laborable", turn: "Turno" };
      if (door.key === "NOC-FES") return { ...door, key: "FES-SUPER", label: "Super", dayType: "festivo", turn: "Turno" };
      if (door.key === "FES") return { ...door, key: "FES-DIURNO", label: "Diurno", dayType: "festivo", turn: "Turno" };
      return door;
    })
    .filter((door) => door.dayType === "laborable" || door.dayType === "festivo");
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
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="App CPE" />
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
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="App CPE" />
      </div>
      <strong className="brand-text">CPE</strong>
      <button className="header-icon" type="button" aria-label="Menu">
        <Menu size={28} />
      </button>
      <button className="header-icon settings" type="button" aria-label="Ajustes">
        <Settings size={21} />
      </button>
      {user && (
        <button className="logout-button" type="button" onClick={onLogout}>
          <Mail size={18} />
          Salir
        </button>
      )}
    </header>
  );
}

function Hero({ now, doorConfig }) {
  return (
    <section className="hero-card">
      <h1>Puertas Fijos</h1>
      <p>{formatClock(now)}</p>
      <span />
      {doorConfig?.updatedAt && (
        <small>Actualizado: {new Date(doorConfig.updatedAt).toLocaleString("es-ES")}</small>
      )}
    </section>
  );
}

function UserStrip({ user, doors }) {
  const nearest = doors
    .filter((item) => item.distance !== null)
    .sort((a, b) => a.distance - b.distance)[0];

  return (
    <section className="user-strip">
      <div>
        <span>Chapa</span>
        <strong>{user.chapa}</strong>
      </div>
      <div>
        <span>Posicion</span>
        <strong>{user.position}/{censo.length}</strong>
      </div>
      <div>
        <span>Mas cerca</span>
        <strong>{nearest ? nearest.label : "-"}</strong>
      </div>
      <div>
        <span>Distancia</span>
        <strong>{nearest ? formatDistance(nearest.distance) : "-"}</strong>
      </div>
    </section>
  );
}

function DoorsTable({ title, Icon, doors, tone }) {
  return (
    <section className="doors-table-section">
      <h2><span><Icon size={16} /></span>{title}</h2>
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
                <td>{door.label}</td>
                <td>
                  <span className={`door-badge ${tone}`}>{door.raw}</span>
                  <small>{door.doorChapa}</small>
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

function CensoGrid({ user, doors }) {
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
    <section className="censo-section">
      <div className="section-title-row">
        <div>
          <p>Censo: {censo.length}</p>
          <h2>{specialty.name}</h2>
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
              {door && <em>{door.label}</em>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Navegacion inferior">
      <a href="#inicio">
        <Home size={24} />
        <span>Inicio</span>
      </a>
      <a href="#contratacion">
        <Clipboard size={24} />
        <span>Mi Contratacion</span>
      </a>
      <a href="#sueldometro" className="premium">
        <b>S</b>
        <span>Sueldometro</span>
      </a>
      <a href="#puertas" className="active">
        <CalendarDays size={24} />
        <span>Puertas</span>
      </a>
      <a href="#tablon">
        <ClipboardList size={24} />
        <span>Tablon</span>
      </a>
    </nav>
  );
}

function StatusLine({ doorConfig }) {
  const validation = validateCenso();

  return (
    <div className="status-line">
      <RefreshCcw size={16} />
      <span>
        Censo {validation.count}/{validation.expected} - Puertas {doorConfig?.updatedAt ? "online" : "locales"} - solo TURNO
      </span>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState(getInitialSession);
  const [doorConfig, setDoorConfig] = useState(null);
  const [now, setNow] = useState(() => new Date());

  const user = session ? findByChapa(session.chapa) : null;
  const activeDoors = sanitizeDoors(doorConfig?.doors);
  const doors = useMemo(() => getDoorState(user?.chapa, activeDoors), [user?.chapa, activeDoors]);
  const laborableDoors = doors.filter((door) => door.dayType === "laborable");
  const festivoDoors = doors.filter((door) => door.dayType === "festivo");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
        if (!cancelled && Array.isArray(response?.doors)) {
          setDoorConfig(response);
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
      <main className="content" id="puertas">
        <Hero now={now} doorConfig={doorConfig} />
        <UserStrip user={user} doors={doors} />
        <StatusLine doorConfig={doorConfig} />
        <DoorsTable title="Puertas Laborables" Icon={FileText} doors={laborableDoors} tone="lab" />
        <DoorsTable title="Puertas Festivas" Icon={CalendarDays} doors={festivoDoors} tone="fes" />
        <CensoGrid user={user} doors={doors} />
      </main>
      <BottomNav />
    </div>
  );
}
