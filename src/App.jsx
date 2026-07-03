import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
  Home,
  Link as LinkIcon,
  ListChecks,
  Lock,
  LogOut,
  Moon,
  Search,
  Sun,
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
  getLatestChaperoSnapshot,
  getLatestDoorSnapshot,
  loginUser,
  registerUser,
  requestChaperoRefresh,
  requestDoorRefresh,
  trackUsageEvent,
  updateUserSpecialties
} from "./supabaseClient.js";

const STORAGE_KEY = "app-cpe-session";
const SPECIALTY_OVERRIDES_KEY = "app-cpe-specialty-overrides";
const THEME_KEY = "app-cpe-theme";
const SNAPSHOT_POLL_MS = 60_000;
const SNAPSHOT_REFRESH_POLL_MS = 5_000;
const SNAPSHOT_REFRESH_POLL_ATTEMPTS = 24;
const CHAPERO_POLL_MS = 60_000;
const CHAPERO_REFRESH_POLL_MS = 5_000;
const CHAPERO_REFRESH_POLL_ATTEMPTS = 24;

const NAV_ITEMS = [
  { id: "inicio", label: "Inicio", Icon: Home },
  { id: "puertas", label: "Puertas", Icon: CalendarDays },
  { id: "censo", label: "Censo", Icon: UsersRound },
  { id: "mis-especialidades", label: "Mis esp.", Icon: ListChecks },
  { id: "enlaces", label: "Enlaces", Icon: LinkIcon }
];

function getInitialSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
    const chapa = normalizeChapa(parsed?.chapa);
    if (!chapa) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return { ...parsed, chapa };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function getInitialTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    return "light";
  }

  return "light";
}

function formatDistance(value) {
  if (value === null) return "Sin dato";
  if (value === 0) return "En puerta";
  return `${value} posiciones`;
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

function formatCurrentDateTime(value) {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}

function formatChaperoStatus(status, isLoading = false) {
  if (isLoading) return "Cargando...";

  const labels = {
    contratado: "Contratado",
    anticipado: "Anticipado",
    nocontratado: "No contratado",
    falta: "No disponible",
    excepcion: "Con excepcion",
    doble: "Doble"
  };

  return labels[status] || "No encontrado";
}

function normalizeChaperoWorker(worker) {
  return {
    ...worker,
    chapa: normalizeChapa(worker?.chapa || worker?.rawChapa)
  };
}

function formatJornadaContratada(snapshot, isLoading = false) {
  if (isLoading) return "Cargando jornada...";
  if (!snapshot?.jornadaDate || !snapshot?.fromHour || !snapshot?.toHour) return "Sin jornada";
  return `${snapshot.jornadaDate} ${snapshot.fromHour}-${snapshot.toHour}`;
}

function findChaperoWorker(chaperoSnapshot, chapa) {
  const normalized = normalizeChapa(chapa);
  if (!normalized || !Array.isArray(chaperoSnapshot?.workers)) return null;
  return chaperoSnapshot.workers.map(normalizeChaperoWorker).find((worker) => worker.chapa === normalized) || null;
}

async function loadLocalChaperoSnapshot() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/chapero-snapshot.json`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data?.workers) ? data : null;
  } catch {
    return null;
  }
}

function isActiveChaperoStatus(status) {
  return status === "contratado" || status === "anticipado";
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

  return ["NOC", "LAB", "NOC-FES", "FES"]
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

function getInvalidSpecialtyNamesForChapa(chapa, selectedIds) {
  const normalized = normalizeChapa(chapa);
  return selectedIds
    .filter((id) => !findByChapa(normalized, id))
    .map((id) => getSpecialty(id).name);
}

function getDetectedSpecialtyIdsForChapa(chapa) {
  const normalized = normalizeChapa(chapa);
  if (!normalized) return [];
  return specialties
    .filter((item) => findByChapa(normalized, item.id))
    .map((item) => item.id);
}

function uniqueIds(ids) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function getStoredOverrides() {
  try {
    return JSON.parse(localStorage.getItem(SPECIALTY_OVERRIDES_KEY)) || {};
  } catch {
    return {};
  }
}

function getSpecialtyOverride(chapa) {
  const normalized = normalizeChapa(chapa);
  if (!normalized) return null;
  const value = getStoredOverrides()[normalized];
  return Array.isArray(value) ? value : null;
}

function saveSpecialtyOverride(chapa, ids) {
  const normalized = normalizeChapa(chapa);
  if (!normalized) return;
  const overrides = getStoredOverrides();
  overrides[normalized] = ids;
  localStorage.setItem(SPECIALTY_OVERRIDES_KEY, JSON.stringify(overrides));
}

function getEffectiveSpecialtyIds(session) {
  if (!session?.chapa) return [specialty.id];
  const override = getSpecialtyOverride(session.chapa);
  const detectedIds = getDetectedSpecialtyIdsForChapa(session.chapa);
  const savedIds = Array.isArray(session.specialties) ? session.specialties : [];
  const baseIds = override || uniqueIds([...detectedIds, ...savedIds]);
  const validIds = getValidSpecialtiesForChapa(session.chapa, baseIds);
  return validIds.length ? validIds : (detectedIds[0] ? [detectedIds[0]] : [specialty.id]);
}

function getSpecialtyKind(item) {
  return item.kind === "polivalencia" ? "polivalencia" : "especialidad";
}

function getSpecialtyLabel(item) {
  return item?.name?.replace(/^POL\.\s*/, "") || "";
}

function LoginPanel({ theme, onThemeToggle, onLogin }) {
  const [mode, setMode] = useState("login");
  const [chapa, setChapa] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      const detectedSpecialties = getDetectedSpecialtyIdsForChapa(normalized);

      if (mode === "register" && detectedSpecialties.length === 0) {
        setError("Esta chapa no aparece en ningun censo cargado.");
        return;
      }

      const response = mode === "register"
        ? await registerUser({
          chapa: normalized,
          password,
          specialties: detectedSpecialties
        })
        : await loginUser({ chapa: normalized, password });

      if (!response?.token) throw new Error("No se pudo iniciar sesion.");
      trackUsageEvent({
        eventType: mode === "register" ? "register" : "login",
        chapa: normalized,
        metadata: { specialties: response.specialties || detectedSpecialties }
      });
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
      <button
        className="login-theme-button"
        type="button"
        onClick={onThemeToggle}
        aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <div className="login-logo">
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="App CPE" />
      </div>
      <h1>App CPE</h1>

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
            autoComplete={mode === "login" ? "current-password" : "new-password"}
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

      {mode === "register" && <p className="login-hint">La app detectara tus especialidades por la chapa.</p>}

      {error && <p className="form-error">{error}</p>}

      <button className="primary-button" type="submit" disabled={loading}>
        {loading ? "Procesando..." : mode === "register" ? "Crear cuenta" : "Entrar"}
      </button>
    </form>
  );
}

function AppHeader({ user, theme, onThemeToggle, onLogout }) {
  return (
    <header className="app-header">
      <div className="logo-box">
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="App CPE" />
      </div>
      <div className="header-title">
        <strong>App CPE</strong>
      </div>
      <button
        className="theme-button"
        type="button"
        onClick={onThemeToggle}
        aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>
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
  chaperoSnapshot,
  chaperoWorker,
  chaperoLoading,
  currentTime,
  notice,
  activeSpecialty,
  availableSpecialties,
  activeSpecialtyId,
  onSpecialtyChange
}) {
  const nearest = getNearestDoor(doors);
  const updatedLabel = formatUpdatedAt(doorConfig?.updatedAt);
  const showRollOnAlert = (
    activeSpecialty.id === "pol-especialista"
    && nearest?.distance !== null
    && nearest?.distance < 50
  );

  return (
    <section className="page-panel">
      <section className={`chapero-card ${chaperoLoading ? "loading" : chaperoWorker?.status || "empty"}`}>
        <div className="jornada-card">
          <span>Ultima jornada contratada</span>
          <strong>{formatJornadaContratada(chaperoSnapshot, chaperoLoading)}</strong>
        </div>

        <div className="chapero-meta-row">
          <span>{formatCurrentDateTime(currentTime)}</span>
          <small>Chapa {user?.chapa || "-"}</small>
        </div>

        <div className="chapero-status-row">
          <div className="chapero-status-copy">
            <span>Estado:</span>
            <strong>{formatChaperoStatus(chaperoWorker?.status, chaperoLoading)}</strong>
          </div>
          <div className="chapero-status-badge">
            {chaperoLoading
              ? <Clock3 size={17} />
              : isActiveChaperoStatus(chaperoWorker?.status) ? <BadgeCheck size={17} /> : <CircleAlert size={17} />}
            <span>Chapero</span>
          </div>
        </div>

        <div className="chapero-summary">
          <div><strong>{chaperoLoading ? "..." : chaperoSnapshot?.summary?.contratado ?? "-"}</strong><span>Contr.</span></div>
          <div><strong>{chaperoLoading ? "..." : chaperoSnapshot?.summary?.anticipado ?? "-"}</strong><span>Ant.</span></div>
          <div><strong>{chaperoLoading ? "..." : chaperoSnapshot?.summary?.nocontratado ?? "-"}</strong><span>No cont.</span></div>
          <div><strong>{chaperoLoading ? "..." : chaperoSnapshot?.summary?.falta ?? "-"}</strong><span>N.D.</span></div>
        </div>

        <div className="chapero-updated">
          <Clock3 size={14} />
          <span>{chaperoLoading ? "Cargando Chapero..." : `Actualizado: ${formatUpdatedAt(chaperoSnapshot?.updatedAt)}`}</span>
        </div>
      </section>

      <div className="specialty-select">
        <span>Especialidad</span>
        <select value={activeSpecialtyId} onChange={(event) => onSpecialtyChange(event.target.value)}>
          {availableSpecialties.map((item) => (
            <option key={item.id} value={item.id}>{getSpecialtyLabel(item)}</option>
          ))}
        </select>
      </div>

      <div className="home-summary">
        <div>
          <p>Tu posicion</p>
          <h1>{user?.displayPosition || user?.position || "-"} / {activeSpecialty.censo.length}</h1>
          <span>Chapa {user?.chapa || "-"}</span>
          <div className="ring-legend" aria-label="Leyenda de circulos">
            <span><i className="legend-dot user" /> Tu posicion</span>
            <span><i className="legend-dot door" /> Puerta</span>
          </div>
        </div>
      </div>

      <div className="quick-grid">
        <article>
          <span>Puerta mas cercana</span>
          <strong>{nearest ? nearest.label : "-"}</strong>
          <small>{nearest ? `${nearest.shift} - ${formatDistance(nearest.distance)}` : "Sin dato"}</small>
        </article>
        <article>
          <span>Estado</span>
          <strong>{doorConfig?.updatedAt ? "Actualizado" : "Local"}</strong>
          <small>{updatedLabel}</small>
        </article>
      </div>

      {showRollOnAlert && (
        <div className="rollon-alert">
          <div className="rollon-alert-icon">
            <CircleAlert size={20} />
          </div>
          <div>
            <span>Estiba cerca</span>
            <strong>Puerta a {formatDistance(nearest.distance)}</strong>
            <small>Si el doble se pone a las 18:00 o 19:00, la opcion de salir de roll-on es alta.</small>
          </div>
        </div>
      )}

      <DoorRingsGrid user={user} doors={doors} total={activeSpecialty.censo.length} />

      {notice && <p className="inline-notice">{notice}</p>}
    </section>
  );
}

function SpecialtyBlock({ title, items, selectedIds, onToggle }) {
  return (
    <section className="specialty-manage-block">
      <div className="block-title-row">
        <span>{title}</span>
        <strong>{items.length}</strong>
      </div>
      <div className="specialty-picker inline">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={selectedIds.includes(item.id) ? "selected" : ""}
            onClick={() => onToggle(item.id)}
          >
            <Check size={15} />
            {getSpecialtyLabel(item)}
          </button>
        ))}
      </div>
    </section>
  );
}

function MySpecialtiesPanel({ session, availableSpecialties, notice, onSpecialtiesSave }) {
  const [selectedSpecialties, setSelectedSpecialties] = useState(availableSpecialties.map((item) => item.id));
  const detectedIds = useMemo(() => getDetectedSpecialtyIdsForChapa(session.chapa), [session.chapa]);
  const specialtyItems = specialties.filter((item) => getSpecialtyKind(item) === "especialidad");
  const polyvalenceItems = specialties.filter((item) => getSpecialtyKind(item) === "polivalencia");

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
      <div className="section-heading">
        <p>Chapa {session.chapa}</p>
        <h1>Mis especialidades</h1>
        <span>Detectadas automaticamente: {detectedIds.length}</span>
      </div>

      <SpecialtyBlock
        title="Especialidades"
        items={specialtyItems}
        selectedIds={selectedSpecialties}
        onToggle={toggleSpecialty}
      />
      <SpecialtyBlock
        title="Polivalencias"
        items={polyvalenceItems}
        selectedIds={selectedSpecialties}
        onToggle={toggleSpecialty}
      />

      <button className="secondary-button" type="button" onClick={() => onSpecialtiesSave(selectedSpecialties)}>
        Guardar seleccion
      </button>
      {notice && <p className="inline-notice">{notice}</p>}
    </section>
  );
}

function formatCompactDistance(value) {
  if (value === null) return "--";
  if (value === 0) return "0";
  return String(value);
}

function getDoorGroupLabel(door) {
  return door.dayType === "festivo" ? "Festiva" : "Laborable";
}

function DoorRingsGrid({ user, doors, total }) {
  return (
    <section className="door-rings-grid" aria-label="Distancia visual a puertas">
      {doors.map((door) => (
        <DoorMiniRing key={door.key} user={user} door={door} total={total} />
      ))}
    </section>
  );
}

function DoorMiniRing({ user, door, total }) {
  const userPercent = user?.position && total ? (user.position / total) * 100 : 0;
  const doorPercent = door?.doorPosition && total ? (door.doorPosition / total) * 100 : 0;
  const distanceClass = classifyDistance(door.distance);

  return (
    <article className={`door-ring-card ${distanceClass}`}>
      <div
        className="mini-position-ring"
        style={{
          "--user-angle": `${userPercent * 3.6}deg`,
          "--door-angle": `${doorPercent * 3.6}deg`
        }}
        aria-hidden="true"
      >
        <span className="ring-dot user-dot" />
        <span className="ring-dot door-dot" />
        <strong>{formatCompactDistance(door.distance)}</strong>
      </div>
      <div>
        <span>{getDoorGroupLabel(door)}</span>
        <strong>{door.label}</strong>
        <small>{door.doorChapa || door.raw || "-"}</small>
      </div>
    </article>
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
              <th>POS.</th>
              <th>CHAPA</th>
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
                  <span className={`door-badge ${tone}`}>{door.doorPosition || "-"}</span>
                </td>
                <td>{door.doorChapa || "-"}</td>
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
        <h1>{getSpecialtyLabel(activeSpecialty)}</h1>
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
          <h1>{getSpecialtyLabel(activeSpecialty)}</h1>
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
  const [theme, setTheme] = useState(getInitialTheme);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [doorConfig, setDoorConfig] = useState(null);
  const [chaperoSnapshot, setChaperoSnapshot] = useState(null);
  const [chaperoLoaded, setChaperoLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState("inicio");
  const [activeSpecialtyId, setActiveSpecialtyId] = useState(() => getInitialSession()?.specialties?.[0] || specialty.id);
  const [notice, setNotice] = useState("");
  const syncRefreshRequestedRef = useRef(false);

  const availableSpecialties = useMemo(() => {
    const ids = getEffectiveSpecialtyIds(session);
    return ids.map(getSpecialty);
  }, [session]);
  const activeSpecialty = getSpecialty(activeSpecialtyId);
  const user = session ? findByChapa(session.chapa, activeSpecialty.id) : null;
  const displayUser = user || (session?.chapa ? { chapa: session.chapa, position: null, displayPosition: null } : null);
  const activeDoors = sanitizeDoors(doorConfig?.doors, activeSpecialty);
  const doors = useMemo(
    () => getDoorState(session?.chapa, activeDoors, activeSpecialty.id),
    [session?.chapa, activeDoors, activeSpecialty.id]
  );
  const chaperoWorker = useMemo(
    () => findChaperoWorker(chaperoSnapshot, session?.chapa),
    [chaperoSnapshot, session?.chapa]
  );

  useEffect(() => {
    if (!availableSpecialties.some((item) => item.id === activeSpecialtyId)) {
      setActiveSpecialtyId(availableSpecialties[0]?.id || specialty.id);
    }
  }, [activeSpecialtyId, availableSpecialties]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Theme persistence is optional; the app still works without localStorage.
    }
  }, [theme]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer = null;
    let pollTimer = null;
    let refreshPollTimer = null;
    let refreshPollAttempts = 0;

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

    function startRefreshPolling() {
      if (refreshPollTimer) window.clearInterval(refreshPollTimer);
      refreshPollAttempts = 0;
      refreshPollTimer = window.setInterval(() => {
        refreshPollAttempts += 1;
        applyLatestSnapshot().catch(() => {});

        if (refreshPollAttempts >= SNAPSHOT_REFRESH_POLL_ATTEMPTS && refreshPollTimer) {
          window.clearInterval(refreshPollTimer);
          refreshPollTimer = null;
        }
      }, SNAPSHOT_REFRESH_POLL_MS);
    }

    applyLatestSnapshot()
      .then((response) => {
        if (!Array.isArray(response?.doors)) return null;
        if (!syncRefreshRequestedRef.current) {
          syncRefreshRequestedRef.current = true;
          refreshTimer = window.setTimeout(() => {
            requestDoorRefresh({ force: true })
              .then((result) => {
                if (cancelled) return;
                if (result?.triggered) startRefreshPolling();
                applyLatestSnapshot().catch(() => {});
              })
              .catch(() => {});
          }, 1500);
        }
        pollTimer = window.setInterval(() => {
          applyLatestSnapshot().catch(() => {});
        }, SNAPSHOT_POLL_MS);
      })
      .catch(() => {
        if (!cancelled) setDoorConfig(null);
      });

    return () => {
      cancelled = true;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      if (pollTimer) window.clearInterval(pollTimer);
      if (refreshPollTimer) window.clearInterval(refreshPollTimer);
    };
  }, [activeSpecialty.id, activeSpecialty.name]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer = null;
    let refreshTimer = null;
    let refreshPollTimer = null;
    let refreshPollAttempts = 0;

    async function loadChaperoSnapshot() {
      const snapshot = await getLatestChaperoSnapshot() || await loadLocalChaperoSnapshot();
      if (!cancelled) {
        setChaperoSnapshot(snapshot);
        setChaperoLoaded(true);
      }
      return snapshot;
    }

    function startChaperoRefreshPolling() {
      if (refreshPollTimer) window.clearInterval(refreshPollTimer);
      refreshPollAttempts = 0;
      refreshPollTimer = window.setInterval(() => {
        refreshPollAttempts += 1;
        loadChaperoSnapshot().catch(() => {});

        if (refreshPollAttempts >= CHAPERO_REFRESH_POLL_ATTEMPTS && refreshPollTimer) {
          window.clearInterval(refreshPollTimer);
          refreshPollTimer = null;
        }
      }, CHAPERO_REFRESH_POLL_MS);
    }

    loadChaperoSnapshot().catch(() => {});
    refreshTimer = window.setTimeout(() => {
      if (syncRefreshRequestedRef.current) {
        startChaperoRefreshPolling();
        loadChaperoSnapshot().catch(() => {});
        return;
      }

      syncRefreshRequestedRef.current = true;
      requestChaperoRefresh()
        .then((result) => {
          if (cancelled) return;
          if (result?.triggered) startChaperoRefreshPolling();
          loadChaperoSnapshot().catch(() => {});
        })
        .catch(() => {});
    }, 1800);
    pollTimer = window.setInterval(() => {
      loadChaperoSnapshot().catch(() => {});
    }, CHAPERO_POLL_MS);

    return () => {
      cancelled = true;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      if (pollTimer) window.clearInterval(pollTimer);
      if (refreshPollTimer) window.clearInterval(refreshPollTimer);
    };
  }, []);

  useEffect(() => {
    if (!session?.chapa) return;
    trackUsageEvent({
      eventType: "app_open",
      chapa: session.chapa,
      metadata: { specialties: getEffectiveSpecialtyIds(session) }
    });
  }, [session?.chapa]);

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
    setNotice("");
    const invalidNames = getInvalidSpecialtyNamesForChapa(session.chapa, selectedIds);
    if (invalidNames.length) {
      setNotice(`No tienes la especialidad de ${invalidNames.join(", ")}.`);
    }

    const validIds = getValidSpecialtiesForChapa(session.chapa, selectedIds);
    const nextIds = validIds.length ? validIds : [activeSpecialtyId];
    saveSpecialtyOverride(session.chapa, nextIds);
    const response = await updateUserSpecialties({ token: session.token, specialties: nextIds });
    const nextSession = response || { ...session, specialties: nextIds };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
    trackUsageEvent({
      eventType: "specialties_update",
      chapa: session.chapa,
      metadata: { specialties: nextIds }
    });
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
        <LoginPanel
          theme={theme}
          onThemeToggle={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
          onLogin={(nextSession) => {
            setSession(nextSession);
            setActiveSpecialtyId(getEffectiveSpecialtyIds(nextSession)[0] || specialty.id);
          }}
        />
      </div>
    );
  }

  return (
    <div className="mobile-app">
      <AppHeader
        user={session}
        theme={theme}
        onThemeToggle={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
        onLogout={logout}
      />
      <main className="content">
        {activeTab === "inicio" && (
          <HomePanel
            user={displayUser}
            doors={doors}
            doorConfig={doorConfig}
            chaperoSnapshot={chaperoSnapshot}
            chaperoWorker={chaperoWorker}
            chaperoLoading={!chaperoLoaded}
            currentTime={currentTime}
            notice={notice}
            activeSpecialty={activeSpecialty}
            activeSpecialtyId={activeSpecialtyId}
            availableSpecialties={availableSpecialties}
            onSpecialtyChange={setActiveSpecialtyId}
          />
        )}
        {activeTab === "puertas" && <DoorsPanel doors={doors} doorConfig={doorConfig} activeSpecialty={activeSpecialty} />}
        {activeTab === "censo" && <CensoPanel user={user} doors={doors} activeSpecialty={activeSpecialty} />}
        {activeTab === "mis-especialidades" && (
          <MySpecialtiesPanel
            session={session}
            availableSpecialties={availableSpecialties}
            notice={notice}
            onSpecialtiesSave={saveSpecialties}
          />
        )}
        {activeTab === "enlaces" && <LinksPanel />}
      </main>
      <BottomNav activeTab={activeTab} onChange={setActiveTab} />
    </div>
  );
}
