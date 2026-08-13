import { useEffect, useMemo, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileLock2,
  Eye,
  EyeOff,
  Home,
  Inbox,
  Link as LinkIcon,
  ClipboardList,
  Lock,
  LogOut,
  Moon,
  Mail,
  Percent,
  RefreshCw,
  ReceiptText,
  Search,
  Ship,
  Sun,
  CalendarCheck2,
  Save,
  UserRound,
  UsersRound,
  WalletCards,
  X
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
  compareJornalesDescending,
  enrichJornales,
  formatEuro,
  summarizeAnnualPayroll,
  summarizePayroll
} from "./payroll.js";
import {
  getLatestChaperoSnapshot,
  getLatestDoorSnapshot,
  loadPayrollConfig,
  getOfficialPortalSnapshot,
  getPortalAutoSyncStatus,
  getPortalSyncJob,
  loginUser,
  registerUser,
  requestPortalSync,
  setPortalAutoSync,
  trackPortalOpen,
  trackUsageEvent,
  updateUserIrpf,
  updateUserSpecialties
} from "./supabaseClient.js";
import GeneralBoard from "./GeneralBoard.jsx";
import { companyLogo, shipImage } from "./generalBoard.js";
import { hashForTab, tabFromHash } from "./navigation.js";

const STORAGE_KEY = "app-cpe-session";
const MONTH_SHORT_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const SPECIALTY_OVERRIDES_KEY = "app-cpe-specialty-overrides";
const THEME_KEY = "app-cpe-theme";
const PORTAL_CREDENTIALS_KEY = "app-cpe-portal-credentials";
const PORTAL_SYNC_TIMINGS_KEY = "app-cpe-portal-sync-timings";
const PORTAL_ACTIVE_SYNC_KEY = "app-cpe-portal-active-sync";
const DEFAULT_PORTAL_SYNC_SECONDS = 150;
const PORTAL_ACTIVE_SYNC_MAX_AGE_MS = 30 * 60 * 1000;
const SNAPSHOT_POLL_MS = 60_000;
const CHAPERO_POLL_MS = 60_000;

function readPortalCredentials(chapa) {
  try {
    const stored = JSON.parse(localStorage.getItem(PORTAL_CREDENTIALS_KEY)) || {};
    const credentials = stored[normalizeChapa(chapa)];
    return credentials?.portalPassword ? credentials : null;
  } catch {
    return null;
  }
}

function writePortalCredentials(chapa, credentials) {
  try {
    const stored = JSON.parse(localStorage.getItem(PORTAL_CREDENTIALS_KEY)) || {};
    const key = normalizeChapa(chapa);
    if (credentials?.portalPassword) stored[key] = credentials;
    else delete stored[key];
    localStorage.setItem(PORTAL_CREDENTIALS_KEY, JSON.stringify(stored));
  } catch {
    // El navegador puede bloquear el almacenamiento privado.
  }
}

function getPortalSyncEstimate(chapa) {
  try {
    const stored = JSON.parse(localStorage.getItem(PORTAL_SYNC_TIMINGS_KEY)) || {};
    const samples = Array.isArray(stored[normalizeChapa(chapa)]) ? stored[normalizeChapa(chapa)] : [];
    if (!samples.length) return DEFAULT_PORTAL_SYNC_SECONDS;
    return Math.max(20, Math.round(samples.reduce((sum, value) => sum + Number(value || 0), 0) / samples.length));
  } catch {
    return DEFAULT_PORTAL_SYNC_SECONDS;
  }
}

function savePortalSyncDuration(chapa, seconds) {
  if (!Number.isFinite(seconds) || seconds < 1) return;
  try {
    const stored = JSON.parse(localStorage.getItem(PORTAL_SYNC_TIMINGS_KEY)) || {};
    const key = normalizeChapa(chapa);
    const samples = Array.isArray(stored[key]) ? stored[key] : [];
    stored[key] = [...samples, Math.round(seconds)].slice(-5);
    localStorage.setItem(PORTAL_SYNC_TIMINGS_KEY, JSON.stringify(stored));
  } catch {
    // La estimacion seguira usando el valor inicial si no hay almacenamiento.
  }
}

function readPortalActiveSync(chapa) {
  try {
    const stored = JSON.parse(localStorage.getItem(PORTAL_ACTIVE_SYNC_KEY)) || {};
    const activeSync = stored[normalizeChapa(chapa)];
    const startedAt = Number(activeSync?.startedAt || 0);
    if (!activeSync?.jobId || !startedAt || Date.now() - startedAt > PORTAL_ACTIVE_SYNC_MAX_AGE_MS) {
      return null;
    }
    return activeSync;
  } catch {
    return null;
  }
}

function writePortalActiveSync(chapa, activeSync) {
  try {
    const stored = JSON.parse(localStorage.getItem(PORTAL_ACTIVE_SYNC_KEY)) || {};
    const key = normalizeChapa(chapa);
    if (activeSync?.jobId) stored[key] = activeSync;
    else delete stored[key];
    localStorage.setItem(PORTAL_ACTIVE_SYNC_KEY, JSON.stringify(stored));
  } catch {
    // Si el almacenamiento no esta disponible, la lectura sigue en el servidor.
  }
}

const NAV_ITEMS = [
  { id: "inicio", label: "Inicio", Icon: Home },
  { id: "puertas", label: "Puertas", Icon: CalendarDays },
  { id: "censo", label: "Censo", Icon: UsersRound },
  { id: "portal", label: "Portal", Icon: BriefcaseBusiness },
  { id: "tablon", label: "Tablón", Icon: ClipboardList },
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
  const source = Array.isArray(doors) ? doors : [];
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

function AppHeader({ user, theme, messages, onInboxOpen, onThemeToggle, onLogout }) {
  const unreadCount = (messages?.rows || []).filter((message) => !message.read).length;
  return (
    <header className="app-header">
      <div className="logo-box">
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="App CPE" />
      </div>
      <div className="header-title">
        <strong>App CPE</strong>
      </div>
      {user && (
        <button className="header-inbox-button" type="button" onClick={onInboxOpen} aria-label="Abrir bandeja de entrada">
          <Mail size={20} />
          {unreadCount > 0 && <span>{unreadCount > 99 ? "99+" : unreadCount}</span>}
        </button>
      )}
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

function InboxModal({ messages, onClose }) {
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const rows = messages?.rows || [];
  return (
    <div className="inbox-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="inbox-modal" role="dialog" aria-modal="true" aria-labelledby="inbox-title">
        <header>
          <span className="portal-personal-icon is-inbox"><Inbox size={22} /></span>
          <div><small>Consultas</small><h2 id="inbox-title">Bandeja de entrada</h2></div>
          <b>{rows.length}</b>
          <button type="button" onClick={onClose} aria-label="Cerrar bandeja"><X size={21} /></button>
        </header>
        {rows.length ? (
          <div className="portal-inbox-list">
            {rows.map((message) => (
              <article className={message.read ? "is-read" : "is-unread"} key={message.id}>
                <span><Mail size={17} /></span>
                <div><strong>{message.title}</strong><small>{message.sender || "Portal CPE"}</small></div>
                <time>{message.date}<small>{message.time}</small></time>
              </article>
            ))}
          </div>
        ) : <p className="portal-personal-empty">No hay mensajes disponibles. Actualiza el portal para consultar la bandeja.</p>}
      </section>
    </div>
  );
}

const ASSIGNMENT_SHIFT_ORDER = {
  "02-08": 1,
  "08-14": 2,
  "14-20": 3,
  "18-00": 4,
  "19-01": 5,
  "20-02": 6
};

function normalizeAssignmentShift(value) {
  const hours = String(value || "").match(/(\d{2})\s*(?:A|-|–)\s*(\d{2})/i);
  return hours ? `${hours[1]}-${hours[2]}` : String(value || "").trim();
}

function CurrentAssignments({ snapshot, currentTime, onLoadPortal }) {
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const assignments = useMemo(() => {
    const today = new Date(currentTime || Date.now());
    today.setHours(0, 0, 0, 0);
    return (snapshot?.payload?.asignaciones?.rows || [])
      .filter((item) => {
        const date = parsePortalDate(item.fecha);
        return date && date >= today;
      })
      .sort((a, b) => {
        const dateDiff = parsePortalDate(a.fecha) - parsePortalDate(b.fecha);
        if (dateDiff) return dateDiff;
        return (ASSIGNMENT_SHIFT_ORDER[normalizeAssignmentShift(a.jornada)] || 99)
          - (ASSIGNMENT_SHIFT_ORDER[normalizeAssignmentShift(b.jornada)] || 99);
      });
  }, [snapshot, currentTime]);

  if (!assignments.length) {
    if (snapshot?.payload) return null;
    return (
      <section className="current-assignments-card is-empty">
        <div className="current-assignments-heading">
          <div className="current-assignments-icon"><ClipboardList size={21} /></div>
          <div>
            <span>Mi contratacion</span>
            <strong>Proximos jornales</strong>
          </div>
        </div>
        <div className="current-assignments-empty">
          <div aria-hidden="true">
            <span>--/--</span>
            <strong>Sin datos cargados</strong>
            <small>Conecta el portal para consultar tu contratacion.</small>
          </div>
          <button type="button" onClick={onLoadPortal}>
            <RefreshCw size={17} />
            Cargar datos
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="current-assignments-card">
      <div className="current-assignments-heading">
        <div className="current-assignments-icon"><ClipboardList size={21} /></div>
        <div>
          <span>Mi contratacion</span>
          <strong>{assignments.length === 1 ? "Proximo jornal" : `${assignments.length} jornales`}</strong>
        </div>
      </div>
      <div className="current-assignments-list">
        {assignments.map((item, index) => {
          const logo = companyLogo(item.empresa);
          return (
          <article key={`${item.parte}-${item.fecha}-${item.jornada}-${index}`}>
            <button
              type="button"
              onClick={() => setSelectedAssignment(item)}
              aria-label={`Ver parte ${item.parte}`}
            >
              <span className="current-assignment-logo">
                {logo ? <img src={logo} alt="" /> : <Building2 size={22} />}
              </span>
              <span className="current-assignment-date">
                <strong>{formatShortPortalDate(item.fecha)}</strong>
                <span>{normalizeAssignmentShift(item.jornada) || "--"}</span>
              </span>
              <span className="current-assignment-copy">
                <strong>{item.especialidad || "Jornal asignado"}</strong>
                <span>{[item.buque, item.empresa].filter((value) => value && !/^--?$/.test(String(value).trim())).join(" - ")}</span>
                <small>{[item.operacion, item.muelle].filter((value) => value && !/^--?$/.test(String(value).trim())).join(" · ")}</small>
              </span>
              <span className="current-assignment-part">
                <span>Parte</span>
                <strong>{item.parte}</strong>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </article>
          );
        })}
      </div>
      {selectedAssignment && (
        <AssignmentDetailModal
          assignment={selectedAssignment}
          currentChapa={snapshot?.chapa}
          onClose={() => setSelectedAssignment(null)}
        />
      )}
    </section>
  );
}

function upcomingDoubleStart(request) {
  const date = parsePortalDate(request.date);
  const startHour = Number.parseInt(String(request.journey || "").match(/^(\d{2})/)?.[1], 10);
  if (!date || !Number.isFinite(startHour)) return null;
  date.setHours(startHour, 0, 0, 0);
  return date;
}

function UpcomingDoubles({ snapshot, currentTime }) {
  const rows = useMemo(() => {
    const now = new Date(currentTime || Date.now());
    return (snapshot?.payload?.dobles?.rows || [])
      .map((request) => ({ ...request, startsAt: upcomingDoubleStart(request) }))
      .filter((request) => request.startsAt && request.startsAt > now)
      .sort((a, b) => a.startsAt - b.startsAt);
  }, [snapshot, currentTime]);

  if (!rows.length) return null;
  return (
    <section className="upcoming-doubles-card">
      <header>
        <span className="portal-personal-icon is-doubles"><CalendarCheck2 size={21} /></span>
        <div><small>Solicitudes activas</small><strong>Próximos dobles</strong></div>
        <b>{rows.length}</b>
      </header>
      <div className="portal-doubles-list">
        {rows.map((request, index) => (
          <article key={`${request.date}-${request.specialty}-${request.journey}-${index}`}>
            <time><strong>{request.date.slice(0, 2)}</strong><small>{request.date.slice(3, 5)}</small></time>
            <div><strong>{request.specialty}</strong><small>Jornada {request.journey}</small></div>
            <Check size={17} />
          </article>
        ))}
      </div>
    </section>
  );
}

function AssignmentDetailModal({ assignment, currentChapa, onClose }) {
  const detail = assignment.detail || {};
  const logo = companyLogo(detail.empresa || assignment.empresa);
  const shipName = detail.buque || assignment.buque || "";
  const shipPhoto = shipImage(shipName);
  const specialties = detail.specialties || [];
  const normalizedCurrentChapa = normalizeChapa(currentChapa);

  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const root = document.documentElement;
    const previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow
    };
    const previousRootOverflow = root.style.overflow;

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";

    return () => {
      Object.assign(body.style, previousBodyStyles);
      root.style.overflow = previousRootOverflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  return (
    <div className="assignment-detail-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="assignment-detail-modal" role="dialog" aria-modal="true" aria-label={`Parte ${assignment.parte}`}>
        <header>
          <span className="assignment-detail-logo">
            {logo ? <img src={logo} alt="" /> : <Building2 size={26} />}
          </span>
          <div>
            <span>Parte {assignment.parte}</span>
            <h1>{detail.empresa || assignment.empresa || "Jornal contratado"}</h1>
          </div>
          <button type="button" onClick={onClose} title="Cerrar"><X size={21} /></button>
        </header>

        {shipPhoto && (
          <figure className="assignment-detail-ship">
            <img
              src={shipPhoto}
              alt={`Buque ${shipName}`}
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = "https://portal-estiba-vlc.vercel.app/assets/barcos/barco-generico.jpeg";
              }}
            />
            <figcaption><Ship size={17} /><strong>{shipName}</strong></figcaption>
          </figure>
        )}

        <div className="assignment-detail-summary">
          <div><span>Fecha</span><strong>{formatShortPortalDate(detail.fecha || assignment.fecha)}</strong></div>
          <div><span>Jornada</span><strong>{normalizeAssignmentShift(detail.jornada || assignment.jornada)}</strong></div>
          <div><span>Buque</span><strong>{shipName || "Sin buque"}</strong></div>
          <div><span>Muelle</span><strong>{detail.muelle || assignment.muelle || "-"}</strong></div>
        </div>

        <div className="assignment-detail-operation">
          <Ship size={20} />
          <div><span>Operacion</span><strong>{detail.operacion || assignment.operacion || "-"}</strong></div>
        </div>

        <div className="assignment-detail-workers">
          <div className="assignment-detail-section-title">
            <span>Equipo del parte</span>
            <strong>{specialties.reduce((total, item) => total + Number(item.requested || 0), 0)} trabajadores</strong>
          </div>
          {specialties.length === 0 && (
            <p className="assignment-detail-empty">Actualiza el portal para cargar los nombres del parte.</p>
          )}
          {specialties.map((specialty) => (
            <article key={specialty.name}>
              <header><strong>{specialty.name}</strong><span>{specialty.requested}</span></header>
              <div>
                {specialty.workers?.map((worker) => {
                  const isCurrentWorker = normalizeChapa(worker.code) === normalizedCurrentChapa;
                  return (
                    <p
                      key={`${specialty.name}-${worker.code}-${worker.name}`}
                      className={isCurrentWorker ? "is-current-worker" : ""}
                    >
                      <b>{worker.code}</b>
                      <span>{worker.name}</span>
                      {isCurrentWorker && <em>Tu chapa</em>}
                    </p>
                  );
                })}
                {specialty.bolsa > 0 && (
                  <p className="bolsa"><b>Bolsa</b><span>{specialty.bolsa} trabajadores</span></p>
                )}
                {specialty.unnamed > 0 && <p className="unnamed"><span>{specialty.unnamed} sin nombre publicado</span></p>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function PortalJornalDetailModal({ jornal, onClose }) {
  const logo = companyLogo(jornal?.empresa);
  const payroll = jornal?.payroll || {};

  useEffect(() => {
    const scrollY = window.scrollY;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      window.scrollTo(0, scrollY);
    };
  }, [onClose]);

  if (!jornal) return null;

  return (
    <div className="portal-jornal-detail-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="portal-jornal-detail-modal" role="dialog" aria-modal="true" aria-label={`Detalle del jornal del dia ${jornal.dia}`}>
        <header>
          <span className="portal-jornal-detail-logo">
            {logo ? <img src={logo} alt="" /> : <Building2 size={28} />}
          </span>
          <div>
            <small>Jornal {jornal.dia || "-"}</small>
            <h1>{jornal.empresa || "Jornal contratado"}</h1>
          </div>
          <button type="button" onClick={onClose} title="Cerrar"><X size={22} /></button>
        </header>
        <div className="portal-jornal-detail-total">
          <span>Importe bruto</span>
          <strong>{formatEuro(payroll.total)}</strong>
        </div>
        <div className="portal-jornal-detail-grid">
          <div><span>Jornada</span><strong>{payroll.shift || "-"}</strong></div>
          <div><span>Especialidad</span><strong>{jornal.especialidad || "-"}</strong></div>
          <div><span>Buque</span><strong>{jornal.buque && !/^(?:--?)$/.test(String(jornal.buque).trim()) ? jornal.buque : "Sin buque"}</strong></div>
          <div><span>Operacion</span><strong>{jornal.operacion || "-"}</strong></div>
        </div>
        <div className="portal-jornal-detail-breakdown">
          <div><span>Base</span><strong>{formatEuro(payroll.base)}</strong></div>
          <div><span>Complemento</span><strong>{formatEuro(payroll.complement || 0)}</strong></div>
          {payroll.operationType !== "RECEPCION_ENTREGA" && (
            <div><span>Prima</span><strong>{payroll.prima > 0 ? formatEuro(payroll.prima) : "Pendiente"}</strong></div>
          )}
        </div>
      </section>
    </div>
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
  portalSnapshot,
  notice,
  activeSpecialty,
  availableSpecialties,
  activeSpecialtyId,
  onSpecialtyChange,
  onLoadPortal
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

      <CurrentAssignments snapshot={portalSnapshot} currentTime={currentTime} onLoadPortal={onLoadPortal} />
      <UpcomingDoubles snapshot={portalSnapshot} currentTime={currentTime} />

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
          <strong>{doorConfig?.updatedAt ? "Actualizado" : "Sin datos"}</strong>
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

function PortalFeatureCard({ icon, title, children }) {
  return (
    <article className="portal-feature-card">
      <div className="portal-feature-icon">{icon}</div>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </article>
  );
}

const WEEKDAYS_ES = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function parsePortalDate(value) {
  const normalized = String(value || "").trim();
  const dayFirst = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const yearFirst = normalized.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!dayFirst && !yearFirst) return null;
  const year = Number(dayFirst?.[3] || yearFirst?.[1]);
  const month = Number(dayFirst?.[2] || yearFirst?.[2]);
  const day = Number(dayFirst?.[1] || yearFirst?.[3]);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatShortPortalDate(value) {
  const date = parsePortalDate(value);
  return date
    ? `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`
    : String(value || "").slice(0, 5);
}

function formatVacationRange(period) {
  const start = parsePortalDate(period?.inicio);
  const end = parsePortalDate(period?.fin);
  if (!start || !end) return [period?.inicio, period?.fin].filter(Boolean).join(" - ");
  const startLabel = `${start.getDate()} ${MONTHS_ES[start.getMonth()]}`;
  const endLabel = `${end.getDate()} ${MONTHS_ES[end.getMonth()]}`;
  return start.getTime() === end.getTime() ? startLabel : `${startLabel} - ${endLabel}`;
}

function PortalVacationPreview({ vacaciones }) {
  const periods = vacaciones?.rows || [];
  const months = useMemo(() => {
    const byMonth = new Map();
    periods.forEach((period) => {
      const start = parsePortalDate(period.inicio);
      const end = parsePortalDate(period.fin);
      if (!start || !end) return;
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      const finalMonth = new Date(end.getFullYear(), end.getMonth(), 1);
      while (cursor <= finalMonth) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
        if (!byMonth.has(key)) byMonth.set(key, { key, year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    });
    return [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [periods]);
  const [selectedMonthKey, setSelectedMonthKey] = useState("");

  useEffect(() => {
    if (months.length && !months.some((month) => month.key === selectedMonthKey)) {
      setSelectedMonthKey(months[0].key);
    }
  }, [months, selectedMonthKey]);

  if (!vacaciones?.recognized || periods.length === 0 || months.length === 0) return null;
  const accumulatedDays = Math.max(
    Number(vacaciones.totalDays) || 0,
    ...periods.map((period) => Number(period.acumulado) || 0)
  );
  const selectedMonth = months.find((month) => month.key === selectedMonthKey) || months[0];
  const totalDaysInMonth = new Date(selectedMonth.year, selectedMonth.month, 0).getDate();
  const firstDay = new Date(selectedMonth.year, selectedMonth.month - 1, 1).getDay();
  const leadingBlanks = (firstDay + 6) % 7;
  const vacationDays = new Set();
  periods.forEach((period) => {
    const start = parsePortalDate(period.inicio);
    const end = parsePortalDate(period.fin);
    if (!start || !end) return;
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      if (cursor.getFullYear() === selectedMonth.year && cursor.getMonth() + 1 === selectedMonth.month) {
        vacationDays.add(cursor.getDate());
      }
    }
  });

  return (
    <section className="portal-vacation-card">
      <div className="portal-vacation-heading">
        <div className="portal-vacation-icon"><CalendarDays size={22} /></div>
        <div>
          <p>Vacaciones {vacaciones.year || ""}</p>
          <h1>{accumulatedDays} dias asignados</h1>
        </div>
        <strong>{periods.length} {periods.length === 1 ? "periodo" : "periodos"}</strong>
      </div>
      <div className="portal-vacation-month-tabs">
        {months.map((month) => (
          <button className={month.key === selectedMonth.key ? "is-active" : ""} type="button" key={month.key} onClick={() => setSelectedMonthKey(month.key)}>
            {MONTHS_ES[month.month - 1]} {month.year}
          </button>
        ))}
      </div>
      <div className="portal-vacation-calendar">
        {["L", "M", "X", "J", "V", "S", "D"].map((day) => <span className="portal-vacation-weekday" key={day}>{day}</span>)}
        {Array.from({ length: leadingBlanks }, (_, index) => <i key={`blank-${index}`} />)}
        {Array.from({ length: totalDaysInMonth }, (_, index) => {
          const day = index + 1;
          const isVacation = vacationDays.has(day);
          return <span className={isVacation ? "is-vacation" : ""} key={day}>{day}{isVacation && <small>VA</small>}</span>;
        })}
      </div>
      <div className="portal-vacation-periods compact">
        {periods.map((period, index) => {
          return (
            <article key={`${period.inicio}-${period.fin}-${index}`}>
              <div>
                <strong>{formatVacationRange(period)}</strong>
                <span>{period.dias} {Number(period.dias) === 1 ? "dia" : "dias"}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PortalCalendarPreview({ descansos, slRows = [] }) {
  const months = descansos?.months || [];
  const slPositionByDate = useMemo(() => {
    const positions = new Map();
    slRows.forEach((item) => {
      const match = String(item.fecha || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!match) return;
      positions.set(`${match[3]}-${match[2]}-${match[1]}`, String(item.posicion || "").trim());
    });
    return positions;
  }, [slRows]);
  const defaultMonthIndex = useMemo(() => {
    if (!months.length) return 0;
    const now = new Date();
    const currentIndex = months.findIndex((item) => (
      Number(item.month) === now.getMonth() + 1 && Number(item.year) === now.getFullYear()
    ));
    if (currentIndex !== -1) return currentIndex;
    const withCodesIndex = months.findIndex((item) => (
      item.days?.some((day) => day.code) || item.codes?.length
    ));
    return withCodesIndex === -1 ? 0 : withCodesIndex;
  }, [months]);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState(defaultMonthIndex);

  useEffect(() => {
    setSelectedMonthIndex(defaultMonthIndex);
  }, [defaultMonthIndex]);

  const month = months[selectedMonthIndex] || months[defaultMonthIndex] || months[0];
  if (!month) return null;
  const days = month.days?.length
    ? month.days
    : Array.from({ length: 31 }, (_, index) => ({ day: index + 1, code: month.codes?.[index] || "" }));
  const today = new Date();
  const isCurrentMonth = Number(month.month) === today.getMonth() + 1 && Number(month.year) === today.getFullYear();

  return (
    <section className="portal-calendar-card">
      <div className="section-title-row compact">
        <div>
          <p>Calendario</p>
          <h1>{month.title}</h1>
        </div>
      </div>
      {months.length > 1 && (
        <div className="portal-month-tabs" role="tablist" aria-label="Meses de descansos">
          {months.map((item, index) => (
            <button
              key={`${item.year || ""}-${item.month || ""}-${item.title}`}
              className={index === selectedMonthIndex ? "is-active" : ""}
              type="button"
              onClick={() => setSelectedMonthIndex(index)}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}
      <div className="portal-calendar-grid">
        {["L", "M", "X", "J", "V", "S", "D"].map((weekday) => (
          <div className="portal-weekday" key={weekday}>{weekday}</div>
        ))}
        {days.map((item) => {
          const day = item.day;
          const code = item.code || "";
          const date = new Date(Number(month.year), Number(month.month) - 1, day);
          const dateKey = `${month.year}-${String(month.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const slPosition = code.toUpperCase() === "SL" ? slPositionByDate.get(dateKey) : "";
          const gridColumn = day === 1 ? ((date.getDay() + 6) % 7) + 1 : undefined;
          const isToday = isCurrentMonth && day === today.getDate();
          return (
            <div
              key={day}
              className={`portal-day ${code.toLowerCase()} ${isToday ? "is-today" : ""}`}
              style={gridColumn ? { gridColumnStart: gridColumn } : undefined}
            >
              <span>{day}</span>
              <small>{WEEKDAYS_ES[date.getDay()]}</small>
              {code && (
                <strong
                  className={slPosition ? "portal-day-sl-position" : undefined}
                  title={slPosition ? `Posicion SL ${slPosition}` : undefined}
                >
                  {slPosition ? `${code} · ${slPosition}` : code}
                </strong>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PortalResultPreview({ snapshot, session, onSessionChange }) {
  const payload = snapshot?.payload || null;
  const primas = payload?.primas?.rows || [];
  const premiumHistory = Array.isArray(payload?.primas?.history) ? payload.primas.history : [];
  const jornales = (!payload?.primas?.locked && primas.length > 0)
    ? primas
    : (payload?.jornales?.rows || []);
  const journalHistory = useMemo(() => {
    if (premiumHistory.length > 0) return premiumHistory;
    const savedHistory = payload?.jornales?.history;
    if (Array.isArray(savedHistory) && savedHistory.length > 0) return savedHistory;
    if (!jornales.length) return [];

    return [{
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      monthLabel: payload?.jornales?.monthLabel || "Mes actual",
      rows: jornales
    }];
  }, [jornales, payload?.jornales?.history, payload?.jornales?.monthLabel, premiumHistory]);
  const descansos = payload?.descansos || null;
  const slRows = payload?.sl?.rows || [];
  const vacaciones = payload?.vacaciones || null;
  const nominas = payload?.nominas || null;
  const [selectedPeriod, setSelectedPeriod] = useState("first");
  const [irpfRate, setIrpfRate] = useState(0);
  const [savedIrpfRate, setSavedIrpfRate] = useState(0);
  const [savingIrpf, setSavingIrpf] = useState(false);
  const [irpfMessage, setIrpfMessage] = useState("");
  const [irpfError, setIrpfError] = useState(false);
  const [jornalesExpanded, setJornalesExpanded] = useState(false);
  const [annualExpanded, setAnnualExpanded] = useState(false);
  const [selectedJornal, setSelectedJornal] = useState(null);
  const [payrollConfig, setPayrollConfig] = useState(null);
  const jornalesRef = useRef(null);
  const descansosRef = useRef(null);
  const vacacionesRef = useRef(null);
  const nominasRef = useRef(null);
  const irpfStorageKey = snapshot?.chapa ? `app-cpe-irpf-${snapshot.chapa}` : "";

  useEffect(() => {
    let active = true;
    loadPayrollConfig()
      .then((config) => {
        if (active) setPayrollConfig(config);
      })
      .catch((error) => console.warn("No se pudo cargar la configuracion salarial:", error.message));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const remoteRate = Number.parseFloat(session?.irpfRate);
    const localRate = irpfStorageKey
      ? Number.parseFloat(localStorage.getItem(irpfStorageKey) || "")
      : Number.NaN;
    const nextRate = Number.isFinite(remoteRate) ? remoteRate : localRate;
    const normalizedRate = Number.isFinite(nextRate) ? Math.min(Math.max(nextRate, 0), 60) : 0;
    setIrpfRate(normalizedRate);
    setSavedIrpfRate(normalizedRate);
    setIrpfMessage("");
    setIrpfError(false);
  }, [irpfStorageKey, session?.irpfRate]);

  const saveIrpfRate = async () => {
    setSavingIrpf(true);
    setIrpfMessage("");
    setIrpfError(false);
    try {
      const response = await updateUserIrpf({ token: session.token, irpfRate });
      const persistedRate = Number.parseFloat(response?.irpfRate);
      const normalizedRate = Number.isFinite(persistedRate) ? persistedRate : irpfRate;
      const nextSession = { ...session, ...(response || {}), irpfRate: normalizedRate };
      if (irpfStorageKey) localStorage.setItem(irpfStorageKey, String(normalizedRate));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
      setIrpfRate(normalizedRate);
      setSavedIrpfRate(normalizedRate);
      onSessionChange?.(nextSession);
      setIrpfMessage("IRPF guardado en tu perfil.");
    } catch (requestError) {
      setIrpfError(true);
      setIrpfMessage(requestError.message || "No se pudo guardar el IRPF.");
    } finally {
      setSavingIrpf(false);
    }
  };
  const enrichedJornales = useMemo(
    () => enrichJornales(
      jornales,
      primas,
      (!payload?.primas?.locked && primas.length > 0 ? payload?.primas?.monthLabel : payload?.jornales?.monthLabel) || "",
      payrollConfig
    ),
    [jornales, primas, payload?.primas?.locked, payload?.primas?.monthLabel, payload?.jornales?.monthLabel, payrollConfig]
  );
  const payrollSummary = useMemo(() => summarizePayroll(enrichedJornales), [enrichedJornales]);
  const annualPayroll = useMemo(
    () => summarizeAnnualPayroll(journalHistory, payrollConfig),
    [journalHistory, payrollConfig]
  );
  const selectedJornales = useMemo(
    () => enrichedJornales.filter((item) => {
      if (selectedPeriod === "month") return true;
      const day = Number.parseInt(item.dia, 10);
      if (!Number.isFinite(day)) return selectedPeriod === "first";
      return selectedPeriod === "first" ? day <= 15 : day > 15;
    }),
    [enrichedJornales, selectedPeriod]
  );
  const selectedSummary = useMemo(() => summarizePayroll(selectedJornales), [selectedJornales]);
  const selectedWithholding = selectedSummary.total * (irpfRate / 100);
  const selectedNet = selectedSummary.total - selectedWithholding;
  const visibleJornales = useMemo(
    () => [...selectedJornales].sort(compareJornalesDescending),
    [selectedJornales]
  );
  const selectedPeriodLabel = selectedPeriod === "month"
    ? "mes completo"
    : selectedPeriod === "first" ? "1a quincena" : "2a quincena";

  if (!payload) {
    return (
      <div className="portal-empty-state">
        <BriefcaseBusiness size={26} />
        <strong>Sin datos sincronizados</strong>
        <span>Lee el portal oficial para cargar jornales, mensajes, dobles, nóminas y calendarios.</span>
      </div>
    );
  }

  return (
    <div className="portal-results">
      <section className="portal-sync-card">
        <span>Ultima sincronizacion</span>
        <strong>{formatUpdatedAt(snapshot.updatedAt)}</strong>
        <small>Chapa {snapshot.chapa}</small>
      </section>

      {(jornales.length > 0 || descansos || vacaciones?.recognized || nominas?.recognized) && (
        <nav className="portal-section-shortcuts" aria-label="Accesos a los datos del portal">
          {nominas?.recognized && (
            <button className="is-nominas" type="button" onClick={() => nominasRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <FileLock2 size={19} /><span>Nóminas</span><ChevronDown size={17} />
            </button>
          )}
          {jornales.length > 0 && (
            <button
              type="button"
              className="is-jornales"
              onClick={() => {
                setJornalesExpanded(true);
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => jornalesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
                });
              }}
            >
              <ReceiptText size={19} /><span>Jornales</span><ChevronDown size={17} />
            </button>
          )}
          {descansos && (
            <button className="is-descansos" type="button" onClick={() => descansosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <CalendarDays size={19} /><span>Descansos</span><ChevronDown size={17} />
            </button>
          )}
          {vacaciones?.recognized && (
            <button className="is-vacaciones" type="button" onClick={() => vacacionesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <Sun size={19} /><span>Vacaciones</span><ChevronDown size={17} />
            </button>
          )}
        </nav>
      )}

      {nominas?.recognized && (
        <section ref={nominasRef} className="portal-personal-section portal-payroll-documents portal-scroll-anchor">
          <header>
            <span className="portal-personal-icon is-payroll"><FileLock2 size={21} /></span>
            <div><small>Modo seguro</small><strong>Nómina electrónica</strong></div>
            {!nominas.locked && <b>{nominas.rows?.length || 0}</b>}
          </header>
          {nominas.locked ? (
            <p className="portal-secure-empty"><Lock size={18} /><span><strong>Clave de seguridad necesaria</strong><small>Guárdala en Mi portal y actualiza para consultar tus nóminas.</small></span></p>
          ) : (nominas.rows || []).length ? (
            <div className="portal-payroll-document-list">
              {nominas.rows.map((payroll) => (
                <article key={payroll.id}>
                  <ReceiptText size={18} />
                  <div><strong>{payroll.type}</strong><small>Periodo {payroll.period}</small></div>
                  <span>{payroll.period}</span>
                </article>
              ))}
            </div>
          ) : <p className="portal-personal-empty">No hay nóminas disponibles.</p>}
        </section>
      )}

      {jornales.length > 0 && (
        <section className="portal-salary-section portal-salary-alternative">
          <div className="portal-salary-hero">
            <div className="portal-salary-hero-heading">
              <div className="portal-salary-title">
                <span className="portal-salary-icon"><WalletCards size={22} /></span>
                <div>
                  <small>Extracto salarial</small>
                  <strong>{payload.jornales?.monthLabel || "Ultimo mes"}</strong>
                </div>
              </div>
              <span className="portal-salary-period">{selectedPeriodLabel}</span>
            </div>
            <div className="portal-salary-main">
              <div>
                <span>Neto estimado</span>
                <strong>{formatEuro(selectedNet)}</strong>
                <small>{selectedJornales.length} {selectedJornales.length === 1 ? "jornal" : "jornales"} · IRPF {irpfRate}%</small>
              </div>
              <div className="portal-salary-ring" style={{ "--salary-progress": `${Math.min(Math.max(100 - irpfRate, 0), 100) * 3.6}deg` }}>
                <span>{irpfRate}%</span>
                <small>IRPF</small>
              </div>
            </div>
            <div className="portal-salary-metrics">
              <div><span><ReceiptText size={15} /> Bruto</span><strong>{formatEuro(selectedSummary.total)}</strong></div>
              <div><span><Percent size={15} /> Retencion</span><strong>-{formatEuro(selectedWithholding)}</strong></div>
            </div>
          </div>
          <div className="portal-payroll-summary">
            <button
              className={selectedPeriod === "first" ? "is-active" : ""}
              type="button"
              onClick={() => setSelectedPeriod("first")}
            >
              <span>1a quincena</span>
              <strong>{formatEuro(payrollSummary.firstHalf)}</strong>
            </button>
            <button
              className={selectedPeriod === "second" ? "is-active" : ""}
              type="button"
              onClick={() => setSelectedPeriod("second")}
            >
              <span>2a quincena</span>
              <strong>{formatEuro(payrollSummary.secondHalf)}</strong>
            </button>
            <button
              className={selectedPeriod === "month" ? "is-active" : ""}
              type="button"
              onClick={() => setSelectedPeriod("month")}
            >
              <span>Mes completo</span>
              <strong>{formatEuro(payrollSummary.total)}</strong>
            </button>
          </div>
          {annualPayroll.months.length > 0 && (
            <section className={`portal-annual-summary${annualExpanded ? " is-open" : ""}`}>
              <button type="button" onClick={() => setAnnualExpanded((current) => !current)} aria-expanded={annualExpanded}>
                <span>
                  <CalendarRange size={20} />
                  <span><small>Resumen anual</small><strong>{payload.jornales?.year || new Date().getFullYear()}</strong></span>
                </span>
                <span className="portal-annual-total">
                  <strong>{annualPayroll.count} jornales</strong>
                  <small>{formatEuro(annualPayroll.total)} bruto</small>
                </span>
                <ChevronDown size={19} />
              </button>
              {annualExpanded && (
                <div className="portal-annual-content">
                  <div className="portal-annual-kpis">
                    <div><span>Número de jornales</span><strong>{annualPayroll.count}</strong></div>
                    <div><span>Bruto anual</span><strong>{formatEuro(annualPayroll.total)}</strong></div>
                    <div><span>Media mensual</span><strong>{formatEuro(annualPayroll.activeMonths ? annualPayroll.total / annualPayroll.activeMonths : 0)}</strong></div>
                    <div><span>Neto anual</span><strong>{formatEuro(annualPayroll.total * (1 - irpfRate / 100))}</strong></div>
                  </div>
                  <div className="portal-annual-chart" aria-label="Jornales por mes">
                    {annualPayroll.months.map((month) => {
                      const maxCount = Math.max(1, ...annualPayroll.months.map((item) => item.count));
                      return (
                        <div key={`${month.year}-${month.month}`} title={`${month.monthLabel}: ${month.count} jornales`}>
                          <span>{month.count || ""}</span>
                          <i style={{ height: `${Math.max(month.count ? 12 : 2, (month.count / maxCount) * 72)}px` }} />
                          <small>{MONTH_SHORT_ES[(month.month || 1) - 1]}</small>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}
          <section className="portal-irpf-card" aria-label="Calculo estimado de IRPF">
            <strong>Ajuste de IRPF</strong>
            <span className="portal-irpf-input">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="60"
                step="0.1"
                value={irpfRate}
                onChange={(event) => {
                  const value = Number.parseFloat(event.target.value);
                  setIrpfRate(Number.isFinite(value) ? Math.min(Math.max(value, 0), 60) : 0);
                  setIrpfMessage("");
                }}
                aria-label="Porcentaje de IRPF"
              />
              <b>%</b>
            </span>
            <button
              type="button"
              className="portal-irpf-save"
              disabled={savingIrpf || irpfRate === savedIrpfRate}
              onClick={saveIrpfRate}
              aria-label={savingIrpf ? "Guardando IRPF" : "Guardar IRPF"}
              title={savingIrpf ? "Guardando IRPF" : "Guardar IRPF"}
            >
              {savingIrpf ? <RefreshCw size={17} className="is-spinning" /> : <Save size={17} />}
            </button>
            {irpfMessage && (
              <p className={`portal-irpf-message${irpfError ? " is-error" : ""}`}>{irpfMessage}</p>
            )}
          </section>
          <button
            ref={jornalesRef}
            type="button"
            className={`portal-jornales-heading${jornalesExpanded ? " is-open" : ""}`}
            aria-expanded={jornalesExpanded}
            onClick={() => setJornalesExpanded((current) => !current)}
          >
            <span><ReceiptText size={18} /> Desglose de jornales</span>
            <small>{visibleJornales.length} {visibleJornales.length === 1 ? "jornal" : "jornales"} <ChevronDown size={17} /></small>
          </button>
          {jornalesExpanded && <div className="portal-jornales-list">
            {visibleJornales.length === 0 && (
              <div className="portal-empty-state compact">
                <BriefcaseBusiness size={22} />
                <strong>{selectedPeriod === "month" ? "Sin jornales este mes" : "Sin jornales en esta quincena"}</strong>
              </div>
            )}
            {visibleJornales.map((item, index) => {
              const logo = companyLogo(item.empresa);
              return (
                <article
                  key={`${item.jornal}-${index}`}
                  className={logo ? "has-company-logo" : ""}
                  style={logo ? { "--jornal-company-logo": `url("${logo}")` } : undefined}
                  role="button"
                  tabIndex={0}
                  aria-label={`Ver detalle del jornal del dia ${item.dia}`}
                  onClick={() => setSelectedJornal(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setSelectedJornal(item);
                  }}
                >
                  <div
                    className="portal-jornal-date"
                  >
                    <strong>{item.dia || "-"}</strong>
                    <span>{item.payroll?.shift || "Jornal"}</span>
                  </div>
                  <div className="portal-jornal-content">
                    <div className="portal-jornal-heading">
                      <strong>{item.especialidad || "Jornal"}</strong>
                      <strong className="portal-jornal-total">{formatEuro(item.payroll?.total)}</strong>
                    </div>
                    <em className="portal-jornal-destination">{[item.buque, item.empresa].filter((value) => value && !/^(?:--?|—)$/.test(String(value).trim())).join(" · ")}</em>
                    {item.operacion && <em>{item.operacion}</em>}
                    <div className="portal-jornal-breakdown">
                      <span>Base <b>{formatEuro(item.payroll?.base)}</b></span>
                      {item.payroll?.complement > 0 && <span>Complemento <b>{formatEuro(item.payroll.complement)}</b></span>}
                      {item.payroll?.operationType !== "RECEPCION_ENTREGA" && (
                        <span className={item.payroll?.prima > 0 ? "is-prima" : "is-pending"}>
                          Prima <b>{item.payroll?.prima > 0 ? formatEuro(item.payroll.prima) : "Pendiente"}</b>
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="portal-jornal-chevron" size={19} />
                </article>
              );
            })}
          </div>}
        </section>
      )}

      {descansos && (
        <div ref={descansosRef} className="portal-scroll-anchor">
          <PortalCalendarPreview descansos={descansos} slRows={slRows} />
        </div>
      )}

      <div ref={vacacionesRef} className="portal-scroll-anchor">
        <PortalVacationPreview vacaciones={vacaciones} />
      </div>

      {selectedJornal && <PortalJornalDetailModal jornal={selectedJornal} onClose={() => setSelectedJornal(null)} />}
    </div>
  );
}

function PortalPanel({ session, onSnapshotChange, onSessionChange }) {
  const initialCredentials = useMemo(() => readPortalCredentials(session.chapa), [session.chapa]);
  const initialActiveSync = useMemo(() => readPortalActiveSync(session.chapa), [session.chapa]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [portalPassword, setPortalPassword] = useState(initialCredentials?.portalPassword || "");
  const [securityKey, setSecurityKey] = useState(initialCredentials?.securityKey || "");
  const [savedCredentials, setSavedCredentials] = useState(initialCredentials);
  const [rememberCredentials, setRememberCredentials] = useState(Boolean(initialCredentials));
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(Boolean(initialCredentials));
  const [autoSyncLoading, setAutoSyncLoading] = useState(true);
  const [syncingPortal, setSyncingPortal] = useState(Boolean(initialActiveSync));
  const [portalJob, setPortalJob] = useState(initialActiveSync || null);
  const [portalMessage, setPortalMessage] = useState(initialActiveSync ? "Recuperando la sincronizacion en curso..." : "");
  const [showCredentials, setShowCredentials] = useState(false);
  const [syncProgress, setSyncProgress] = useState(initialActiveSync ? 3 : 0);
  const [syncElapsed, setSyncElapsed] = useState(initialActiveSync ? Math.floor((Date.now() - initialActiveSync.startedAt) / 1000) : 0);
  const syncStartedAtRef = useRef(initialActiveSync?.startedAt || 0);
  const syncEstimateRef = useRef(getPortalSyncEstimate(session.chapa));

  const loadSnapshot = async () => {
    setError("");
    setLoading(true);
    try {
      const data = await getOfficialPortalSnapshot({ token: session.token });
      setSnapshot(data || null);
      onSnapshotChange?.(data || null);
      setShowCredentials(!data);
    } catch (requestError) {
      setError(requestError.message || "No se pudo leer el portal sincronizado.");
      setShowCredentials(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSnapshot();
  }, [session.token]);

  useEffect(() => {
    let cancelled = false;
    getPortalAutoSyncStatus({ token: session.token })
      .then(async (status) => {
        if (cancelled) return;
        if (status?.enabled) {
          setAutoSyncEnabled(true);
          return;
        }

        if (initialCredentials?.portalPassword) {
          await setPortalAutoSync({
            token: session.token,
            enabled: true,
            portalPassword: initialCredentials.portalPassword,
            securityKey: initialCredentials.securityKey || ""
          });
          if (!cancelled) setAutoSyncEnabled(true);
          return;
        }

        setAutoSyncEnabled(false);
      })
      .catch((statusError) => {
        if (!cancelled) console.warn("No se pudo leer la sincronizacion automatica:", statusError.message);
      })
      .finally(() => {
        if (!cancelled) setAutoSyncLoading(false);
      });
    return () => { cancelled = true; };
  }, [initialCredentials, session.token]);

  useEffect(() => {
    if (!syncingPortal || !syncStartedAtRef.current) return undefined;
    const updateProgress = () => {
      const elapsed = Math.max(0, (Date.now() - syncStartedAtRef.current) / 1000);
      const estimate = syncEstimateRef.current;
      const status = portalJob?.status || "queued";
      const calculated = status === "running"
        ? 12 + (elapsed / estimate) * 82
        : 3 + (elapsed / estimate) * 24;
      setSyncElapsed(Math.floor(elapsed));
      setSyncProgress((current) => Math.max(current, Math.min(94, calculated)));
    };
    updateProgress();
    const timer = window.setInterval(updateProgress, 500);
    return () => window.clearInterval(timer);
  }, [syncingPortal, portalJob?.status]);

  useEffect(() => {
    if (!portalJob?.jobId || !["queued", "running"].includes(portalJob.status)) return undefined;

    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        const job = await getPortalSyncJob({ token: session.token, jobId: portalJob.jobId });
        if (stopped || !job) return;
        setPortalJob(job);
        writePortalActiveSync(session.chapa, {
          jobId: portalJob.jobId,
          status: job.status,
          startedAt: syncStartedAtRef.current
        });
        if (job.status === "completed") {
          const measuredSeconds = job.startedAt && job.finishedAt
            ? (new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000
            : (Date.now() - syncStartedAtRef.current) / 1000;
          savePortalSyncDuration(session.chapa, measuredSeconds);
          syncEstimateRef.current = getPortalSyncEstimate(session.chapa);
          setSyncProgress(100);
          setPortalMessage("Portal actualizado.");
          window.clearInterval(timer);
          await loadSnapshot();
          setShowCredentials(false);
          setSyncingPortal(false);
          writePortalActiveSync(session.chapa, null);
        }
        if (job.status === "failed") {
          setPortalMessage(job.message || "No se pudo leer el portal.");
          setSyncingPortal(false);
          setShowCredentials(true);
          writePortalActiveSync(session.chapa, null);
          window.clearInterval(timer);
        }
      } catch (requestError) {
        if (!stopped) {
          setPortalMessage(requestError.message || "No se pudo comprobar la sincronizacion.");
        }
      }
    }, 1500);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [portalJob?.jobId, portalJob?.status, session.token]);

  const handlePortalSync = async () => {
    const passwordToUse = portalPassword.trim() || savedCredentials?.portalPassword || "";
    const securityKeyToUse = securityKey.trim() || savedCredentials?.securityKey || "";
    if (!passwordToUse && !autoSyncEnabled) {
      setError("Introduce la contrasena del portal.");
      setShowCredentials(true);
      return;
    }

    setError("");
    setPortalMessage("Lanzando lectura del portal...");
    setSyncingPortal(true);
    setSyncProgress(3);
    setSyncElapsed(0);
    syncEstimateRef.current = getPortalSyncEstimate(session.chapa);
    syncStartedAtRef.current = Date.now();

    try {
      if ((autoSyncEnabled || rememberCredentials) && passwordToUse) {
        await setPortalAutoSync({
          token: session.token,
          enabled: true,
          portalPassword: passwordToUse,
          securityKey: securityKeyToUse
        });
        setAutoSyncEnabled(true);
      }
      const job = await requestPortalSync({
        token: session.token,
        portalPassword: passwordToUse,
        securityKey: securityKeyToUse
      });
      if (rememberCredentials) {
        const nextCredentials = { portalPassword: passwordToUse, securityKey: securityKeyToUse };
        writePortalCredentials(session.chapa, nextCredentials);
        setSavedCredentials(nextCredentials);
        setPortalPassword(passwordToUse);
        setSecurityKey(securityKeyToUse);
      } else {
        writePortalCredentials(session.chapa, null);
        setSavedCredentials(null);
        setPortalPassword("");
        setSecurityKey("");
      }
      setPortalJob(job);
      writePortalActiveSync(session.chapa, {
        jobId: job.jobId,
        status: job.status || "queued",
        startedAt: syncStartedAtRef.current
      });
      setShowCredentials(false);
      setPortalMessage("Lectura en curso. La app se actualizara automaticamente al terminar.");
    } catch (requestError) {
      setPortalMessage("");
      setSyncingPortal(false);
      setError(requestError.message || "No se pudo lanzar la lectura del portal.");
    }
  };

  const forgetCredentials = () => {
    writePortalCredentials(session.chapa, null);
    setSavedCredentials(null);
    setRememberCredentials(false);
    setPortalPassword("");
    setSecurityKey("");
    setShowCredentials(true);
  };

  const disableAutoSync = async () => {
    setError("");
    setAutoSyncLoading(true);
    try {
      await setPortalAutoSync({ token: session.token, enabled: false });
      setAutoSyncEnabled(false);
    } catch (requestError) {
      setError(requestError.message || "No se pudo desactivar la sincronizacion automatica.");
    } finally {
      setAutoSyncLoading(false);
    }
  };

  const handleAutoSyncToggle = (enabled) => {
    if (enabled) {
      setAutoSyncEnabled(true);
      return;
    }
    disableAutoSync();
  };

  const handleRememberCredentialsToggle = (enabled) => {
    setRememberCredentials(enabled);
    if (enabled) setAutoSyncEnabled(true);
  };

  const syncRemaining = Math.max(0, Math.ceil(syncEstimateRef.current - syncElapsed));

  return (
    <section className="page-panel portal-panel">
      <div className="section-heading">
        <p>Portal oficial</p>
        <h1>Mi portal</h1>
        <span>Jornales, mensajes, dobles, nóminas, descansos y vacaciones en formato claro.</span>
      </div>

      {snapshot && !showCredentials && (
        <div className="portal-update-row">
          <span>
            Datos guardados del portal oficial
            {autoSyncEnabled && <small>Sincronizacion automatica cada hora, tambien a las 07:30, 12:30 y 14:45</small>}
          </span>
          <div>
            {savedCredentials && <button className="portal-forget-button" type="button" onClick={forgetCredentials}>Cambiar claves</button>}
            {autoSyncEnabled && (
              <button className="portal-forget-button" type="button" disabled={autoSyncLoading} onClick={disableAutoSync}>
                Desactivar auto
              </button>
            )}
            <button type="button" disabled={syncingPortal} onClick={(savedCredentials || autoSyncEnabled) ? handlePortalSync : () => setShowCredentials(true)}>
              <RefreshCw size={16} className={syncingPortal ? "is-spinning" : ""} />
              {syncingPortal ? "Actualizando" : "Actualizar portal"}
            </button>
          </div>
        </div>
      )}

      {showCredentials && !syncingPortal && (
        <>
          <p className="portal-warning">
            {rememberCredentials
              ? "La app guardara tus claves solo en este dispositivo para las proximas actualizaciones."
              : "La app usara tus claves solo para leer el portal y borrarlas al terminar la sincronizacion."}
          </p>
          <p className="portal-first-sync-note">
            La espera solo es necesaria la primera vez. Si guardas tus claves, despues la app actualizara tus datos automaticamente en segundo plano.
          </p>

          <section className="portal-security-card">
            <div>
              <p>{snapshot ? "Actualizar portal" : "Conectar con el portal"}</p>
              <span>Introduce tu contraseña del portal oficial y, para primas y nóminas, la clave de seguridad.</span>
            </div>
            <label>
              <Lock size={17} />
              <input
                autoComplete="current-password"
                placeholder="Contrasena del portal"
                type="password"
                value={portalPassword}
                onChange={(event) => setPortalPassword(event.target.value)}
              />
            </label>
            <label>
              <Lock size={17} />
              <input
                autoComplete="off"
                inputMode="numeric"
                placeholder="Clave de seguridad"
                type="password"
                value={securityKey}
                onChange={(event) => setSecurityKey(event.target.value)}
              />
            </label>
            <label className="portal-remember-option">
              <input
                type="checkbox"
                checked={rememberCredentials}
                onChange={(event) => handleRememberCredentialsToggle(event.target.checked)}
              />
              <span>Recordar las claves en este dispositivo</span>
            </label>
            {rememberCredentials && (
              <small className="portal-storage-note">
                Se guardaran en este dispositivo y cifradas en Supabase Vault para las actualizaciones automaticas.
              </small>
            )}
            <label className="portal-remember-option portal-auto-sync-option">
              <input
                type="checkbox"
                checked={autoSyncEnabled}
                disabled={autoSyncLoading}
                onChange={(event) => handleAutoSyncToggle(event.target.checked)}
              />
              <span>Sincronizar cada hora, tambien a las 07:30, 12:30 y 14:45</span>
            </label>
            {autoSyncEnabled && (
              <small className="portal-storage-note">
                Las claves se guardaran cifradas en Supabase Vault. Al desactivar esta opcion se eliminaran del servidor.
              </small>
            )}
            <div className="portal-security-actions">
              {snapshot && !syncingPortal && (
                <button className="secondary-button" type="button" onClick={() => setShowCredentials(false)}>
                  Cancelar
                </button>
              )}
              <button
                className="primary-button"
                type="button"
                disabled={syncingPortal || !portalPassword.trim()}
                onClick={handlePortalSync}
              >
                {syncingPortal ? "Leyendo portal..." : "Leer portal"}
              </button>
            </div>
            {portalMessage && <small>{portalMessage}</small>}
          </section>
        </>
      )}

      {syncingPortal && (
        <section className="portal-progress-card" aria-live="polite">
          <div className="portal-progress-heading">
            <span><RefreshCw size={18} className="is-spinning" />Actualizando portal</span>
            <strong>{Math.round(syncProgress)}%</strong>
          </div>
          <div className="portal-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(syncProgress)}>
            <span style={{ width: `${syncProgress}%` }} />
          </div>
          <div className="portal-progress-meta">
            <span>{portalJob?.status === "running" ? "Leyendo jornales, mensajes, dobles, nóminas y calendarios" : "Preparando la lectura segura"}</span>
            <small>{syncRemaining > 0 ? `Aproximadamente ${syncRemaining} s restantes` : "Finalizando..."} · {syncElapsed} s transcurridos</small>
          </div>
        </section>
      )}

      {error && <p className="portal-warning">{error}</p>}
      {loading && !snapshot ? (
        <div className="portal-empty-state">
          <Clock3 size={26} />
          <strong>Cargando portal</strong>
          <span>Buscando el ultimo sincronizado de tu chapa.</span>
        </div>
      ) : (
        <PortalResultPreview snapshot={snapshot} session={session} onSessionChange={onSessionChange} />
      )}
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

function ContactFooter({ login = false }) {
  return (
    <footer className={`contact-footer${login ? " login-contact-footer" : ""}`}>
      <span>Dudas o sugerencias:</span>
      <a href="mailto:portalestibavlc@gmail.com">portalestibavlc@gmail.com</a>
    </footer>
  );
}

export function App() {
  const [session, setSession] = useState(getInitialSession);
  const [theme, setTheme] = useState(getInitialTheme);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [doorConfig, setDoorConfig] = useState(null);
  const [chaperoSnapshot, setChaperoSnapshot] = useState(null);
  const [portalSnapshot, setPortalSnapshot] = useState(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [chaperoLoaded, setChaperoLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState(() => tabFromHash(window.location.hash));
  const [activeSpecialtyId, setActiveSpecialtyId] = useState(() => getInitialSession()?.specialties?.[0] || specialty.id);
  const [notice, setNotice] = useState("");
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
    const syncTabFromHash = () => {
      const nextTab = tabFromHash(window.location.hash);
      setActiveTab(nextTab);
      const canonicalHash = hashForTab(nextTab);
      if (window.location.hash !== canonicalHash) window.history.replaceState(null, "", canonicalHash);
    };
    syncTabFromHash();
    window.addEventListener("hashchange", syncTabFromHash);
    return () => window.removeEventListener("hashchange", syncTabFromHash);
  }, []);

  const navigateToTab = (tab) => {
    const nextTab = tabFromHash(hashForTab(tab));
    setActiveTab(nextTab);
    if (window.location.hash !== hashForTab(nextTab)) window.location.hash = hashForTab(nextTab);
  };

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
    let pollTimer = null;

    async function loadLatestSnapshot() {
      const snapshot = await getLatestDoorSnapshot(activeSpecialty.name);
      if (snapshot) return snapshot;

      return {
        source: "supabase",
        specialty: activeSpecialty.name,
        updatedAt: null,
        doors: [],
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
      })
      .catch(() => {
        if (!cancelled) setDoorConfig(null);
      });

    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [activeSpecialty.id, activeSpecialty.name]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer = null;

    async function loadChaperoSnapshot() {
      const snapshot = await getLatestChaperoSnapshot() || await loadLocalChaperoSnapshot();
      if (!cancelled) {
        setChaperoSnapshot(snapshot);
        setChaperoLoaded(true);
      }
      return snapshot;
    }

    loadChaperoSnapshot().catch(() => {});
    pollTimer = window.setInterval(() => {
      loadChaperoSnapshot().catch(() => {});
    }, CHAPERO_POLL_MS);

    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
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
    if (!session?.token) {
      setPortalSnapshot(null);
      return undefined;
    }
    let cancelled = false;
    const loadPortalSnapshot = async () => {
      try {
        const data = await getOfficialPortalSnapshot({ token: session.token });
        if (!cancelled) setPortalSnapshot(data || null);
      } catch {
        if (!cancelled) setPortalSnapshot(null);
      }
    };
    loadPortalSnapshot();
    return () => {
      cancelled = true;
    };
  }, [session?.token]);

  useEffect(() => {
    if (!session?.token || activeTab !== "portal") return;
    trackPortalOpen({ token: session.token });
  }, [activeTab, session?.token]);

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
    navigateToTab("inicio");
  };

  if (!session) {
    return (
      <div className="login-screen">
        <div className="login-stack">
          <LoginPanel
            theme={theme}
            onThemeToggle={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
            onLogin={(nextSession) => {
              setSession(nextSession);
              setActiveSpecialtyId(getEffectiveSpecialtyIds(nextSession)[0] || specialty.id);
            }}
          />
          <ContactFooter login />
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-app">
      <AppHeader
        user={session}
        theme={theme}
        messages={portalSnapshot?.payload?.mensajes}
        onInboxOpen={() => setInboxOpen(true)}
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
            portalSnapshot={portalSnapshot}
            notice={notice}
            activeSpecialty={activeSpecialty}
            activeSpecialtyId={activeSpecialtyId}
            availableSpecialties={availableSpecialties}
            onSpecialtyChange={setActiveSpecialtyId}
            onLoadPortal={() => navigateToTab("portal")}
          />
        )}
        {activeTab === "puertas" && <DoorsPanel doors={doors} doorConfig={doorConfig} activeSpecialty={activeSpecialty} />}
        {activeTab === "censo" && <CensoPanel user={user} doors={doors} activeSpecialty={activeSpecialty} />}
        {activeTab === "tablon" && (
          <GeneralBoard
            chapa={session.chapa}
            onOpen={(chapa) => trackUsageEvent({ eventType: "tablon_general_open", chapa })}
          />
        )}
        {activeTab === "portal" && (
          <PortalPanel session={session} onSnapshotChange={setPortalSnapshot} onSessionChange={setSession} />
        )}
        {activeTab === "enlaces" && <LinksPanel />}
        <ContactFooter />
      </main>
      {inboxOpen && <InboxModal messages={portalSnapshot?.payload?.mensajes} onClose={() => setInboxOpen(false)} />}
      <BottomNav activeTab={activeTab} onChange={navigateToTab} />
    </div>
  );
}
