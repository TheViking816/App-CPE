import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
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
  classifyDistance,
  findByChapa,
  getDoorState,
  getSpecialty,
  normalizeChapa,
  specialties,
  specialty
} from "./censo.js";
import {
  getLatestDoorSnapshot,
  loginUser,
  registerUser,
  requestDoorRefresh,
  updateUserSpecialties
} from "./supabaseClient.js";

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

function sanitizeDoors(doors, activeSpecialty = specialty) {
  const source = Array.isArray(doors) ? doors : activeSpecialty.doors;
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

function getValidSpecialtiesForChapa(chapa, selectedIds) {
  const normalized = normalizeChapa(chapa);
  return selectedIds.filter((id) => findByChapa(normalized, id));
}

function LoginPanel({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [chapa, setChapa] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedSpecialties, setSelectedSpecialties] = useState([specialty.id]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const toggleSpecialty = (id) => {
    setSelectedSpecialties((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current, id];
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");

    const normalized = normalizeChapa(chapa);
    if (!normalized) {
      setError("Introduce una chapa valida.");
      return;
    }

    if (!password.trim()) {
      setError("Introduce una contraseña.");
      return;
    }

    try {
      setLoading(true);
      const response = mode === "register"
        ? await registerUser({
          chapa: normalized,
          password,
          specialties: getValidSpecialtiesForChapa(normalized, selectedSpecialties)
        })
        : await loginUser({ chapa: normalized, password });

      if (!response?.token) throw new Error("No se pudo iniciar sesion.");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(response));
      onLogin(response);
    } catch (requestError) {
      setError(requestError.message || "No se pudo acceder.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="login-card" onSubmit={submit}>
      <div className="login-logo">
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="App CPE" />
      </div>
      <h1>App CPE</h1>
      <p>Acceso para fijos.</p>

      <div className="auth-tabs">
        <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
          Entrar
        </button>
        <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
          Registro
        </button>
      </div>

      <label>
        <span>Chapa</span>
        <div className="field">
          <UserRound size={18} />
          <input
            inputMode="numeric"
            placeholder="Ej. 72683"
            value={chapa}
            onChange={(event) => setChapa(event.target.value.replace(/\D/g, "").slice(0, 5))}
          />
        </div>
      </label>

      <label>
        <span>Contraseña</span>
        <div className="field">
          <Lock size={18} />
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Minimo 4 caracteres"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className="icon-button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </label>

      {mode === "register" && (
        <div className="specialty-picker">
          <span>Especialidades</span>
          {specialties.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selectedSpecialties.includes(item.id) ? "selected" : ""}
              onClick={() => toggleSpecialty(item.id)}
            >
              <Check size={15} />
              {item.name}
            </button>
          ))}
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      <button className="primary-button" type="submit" disabled={loading}>
        {loading ? "Procesando..." : mode === "register" ? "Crear cuenta" : "Entrar"}
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
        <span>Fijos CPE Valencia</span>
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

function HomePanel({
  user,
  doors,
  doorConfig,
  activeSpecialty,
  availableSpecialties,
  activeSpecialtyId,
  onSpecialtyChange,
  onSpecialtiesSave
}) {
  const nearest = getNearestDoor(doors);
  const updatedLabel = formatUpdatedAt(doorConfig?.updatedAt);
  const [selectedSpecialties, setSelectedSpecialties] = useState(availableSpecialties.map((item) => item.id));

  useEffect(() => {
    setSelectedSpecialties(availableSpecialties.map((item) => item.id));
  }, [availableSpecialties]);

  const toggleSpecialty = (id) => {
    setSelectedSpecialties((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current, id];
    });
  };

  return (
    <section className="page-panel">
      <div className="specialty-select">
        <span>Especialidad</span>
        <select value={activeSpecialtyId} onChange={(event) => onSpecialtyChange(event.target.value)}>
          {availableSpecialties.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </div>

      <div className="home-summary">
        <p>Tu posicion</p>
        <h1>{user?.displayPosition || user?.position || "-"} / {activeSpecialty.censo.length}</h1>
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

      <section className="manage-specialties">
        <div>
          <span>Mis especialidades</span>
          <strong>Añadir o quitar</strong>
        </div>
        <div className="specialty-picker inline">
          {specialties.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selectedSpecialties.includes(item.id) ? "selected" : ""}
              onClick={() => toggleSpecialty(item.id)}
            >
              <Check size={15} />
              {item.name}
            </button>
          ))}
        </div>
        <button className="secondary-button" type="button" onClick={() => onSpecialtiesSave(selectedSpecialties)}>
          Guardar especialidades
        </button>
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

function DoorsPanel({ doors, doorConfig, activeSpecialty }) {
  const laborableDoors = doors.filter((door) => door.dayType === "laborable");
  const festivoDoors = doors.filter((door) => door.dayType === "festivo");

  return (
    <section className="page-panel">
      <div className="section-heading">
        <p>Puertas de turno</p>
        <h1>{activeSpecialty.name}</h1>
        <span>Actualizado: {formatUpdatedAt(doorConfig?.updatedAt)}</span>
      </div>
      <DoorsTable title="Laborables" doors={laborableDoors} tone="lab" />
      <DoorsTable title="Festivas" doors={festivoDoors} tone="fes" />
    </section>
  );
}

function CensoPanel({ user, doors, activeSpecialty }) {
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
    if (!trimmed) return activeSpecialty.censo;
    return activeSpecialty.censo.filter((item) => String(item.chapa).includes(trimmed) || String(item.displayPosition).includes(trimmed));
  }, [activeSpecialty.censo, query]);

  return (
    <section className="page-panel censo-section">
      <div className="section-title-row">
        <div>
          <p>Censo: {activeSpecialty.censo.length}</p>
          <h1>{activeSpecialty.name}</h1>
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
              <span>{item.displayPosition || item.position}</span>
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
  const links = [
    { label: "Prevision", url: "https://noray.cpevalencia.com/PrevisionDemanda.asp" },
    { label: "Portal CPE", url: "https://portal.cpevalencia.com/" },
    { label: "App descansos", url: "https://descansos-cpe.vercel.app/dashboard" },
    { label: "Sueldometro CPE", url: "https://misueldocpe.vercel.app/" }
  ];

  return (
    <section className="page-panel">
      <div className="section-heading">
        <p>Accesos rapidos</p>
        <h1>Enlaces utiles</h1>
      </div>
      <div className="links-list">
        {links.map((link) => (
          <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
            <span>{link.label}</span>
            <ExternalLink size={18} />
          </a>
        ))}
      </div>
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
  const [activeSpecialtyId, setActiveSpecialtyId] = useState(() => getInitialSession()?.specialties?.[0] || specialty.id);

  const availableSpecialties = useMemo(() => {
    const ids = Array.isArray(session?.specialties) && session.specialties.length ? session.specialties : [specialty.id];
    return ids.map(getSpecialty);
  }, [session?.specialties]);
  const activeSpecialty = getSpecialty(activeSpecialtyId);
  const user = session ? findByChapa(session.chapa, activeSpecialty.id) : null;
  const activeDoors = sanitizeDoors(doorConfig?.doors, activeSpecialty);
  const doors = useMemo(
    () => getDoorState(session?.chapa, activeDoors, activeSpecialty.id),
    [session?.chapa, activeDoors, activeSpecialty.id]
  );

  useEffect(() => {
    if (!availableSpecialties.some((item) => item.id === activeSpecialtyId)) {
      setActiveSpecialtyId(availableSpecialties[0]?.id || specialty.id);
    }
  }, [activeSpecialtyId, availableSpecialties]);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer = null;
    let pollTimer = null;

    async function loadLatestSnapshot() {
      const snapshot = await getLatestDoorSnapshot(activeSpecialty.name);
      if (snapshot) return snapshot;

      return {
        source: "local",
        specialty: activeSpecialty.name,
        updatedAt: null,
        doors: activeSpecialty.doors,
        rawColumns: {}
      };
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
  }, [activeSpecialty.id, activeSpecialty.name]);

  useEffect(() => {
    let cancelled = false;

    async function refreshWhenVisible() {
      if (document.visibilityState !== "visible") return;
      const snapshot = await getLatestDoorSnapshot(activeSpecialty.name);
      if (!cancelled && Array.isArray(snapshot?.doors)) {
        setDoorConfig(snapshot);
      }
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [activeSpecialty.name]);

  const saveSpecialties = async (selectedIds) => {
    const validIds = getValidSpecialtiesForChapa(session.chapa, selectedIds);
    const nextIds = validIds.length ? validIds : [activeSpecialtyId];
    const response = await updateUserSpecialties({ token: session.token, specialties: nextIds });
    const nextSession = response || { ...session, specialties: nextIds };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
    if (!nextIds.includes(activeSpecialtyId)) setActiveSpecialtyId(nextIds[0]);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setActiveTab("inicio");
  };

  if (!session) {
    return (
      <div className="login-screen">
        <LoginPanel onLogin={(nextSession) => {
          setSession(nextSession);
          setActiveSpecialtyId(nextSession.specialties?.[0] || specialty.id);
        }} />
      </div>
    );
  }

  return (
    <div className="mobile-app">
      <AppHeader user={user} onLogout={logout} />
      <main className="content">
        {activeTab === "inicio" && (
          <HomePanel
            user={user}
            doors={doors}
            doorConfig={doorConfig}
            activeSpecialty={activeSpecialty}
            activeSpecialtyId={activeSpecialtyId}
            availableSpecialties={availableSpecialties}
            onSpecialtyChange={setActiveSpecialtyId}
            onSpecialtiesSave={saveSpecialties}
          />
        )}
        {activeTab === "puertas" && <DoorsPanel doors={doors} doorConfig={doorConfig} activeSpecialty={activeSpecialty} />}
        {activeTab === "censo" && <CensoPanel user={user} doors={doors} activeSpecialty={activeSpecialty} />}
        {activeTab === "enlaces" && <LinksPanel />}
      </main>
      <BottomNav activeTab={activeTab} onChange={setActiveTab} />
    </div>
  );
}
