import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadMonthlyPayrollPdfModule } from "./loadMonthlyPayrollPdf.js";
import annualRestCalendarUrl from "../assets/descansos-Bef4loCk.jpg";
import {
  BriefcaseBusiness,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileDown,
  FileLock2,
  Eye,
  EyeOff,
  Home,
  Inbox,
  Info,
  Link as LinkIcon,
  ClipboardList,
  Lock,
  LogOut,
  Menu,
  Moon,
  Mail,
  LoaderCircle,
  MessageCircle,
  Percent,
  RefreshCw,
  ReceiptText,
  Search,
  Send,
  Settings,
  Ship,
  Sun,
  Trash2,
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
  buildVacationPayrollEntries,
  compareJornalesDescending,
  enrichJornales,
  filterJornalesByPeriod,
  mergeUpcomingAssignmentsIntoJornales,
  selectPortalJornales,
  selectPortalJornalesHistory,
  formatEuro,
  summarizeAnnualPayroll,
  summarizePayroll,
  vacationPayrollEntriesForMonth
} from "./payroll.js";
import {
  deleteUserAccount,
  getLatestChaperoSnapshot,
  getLatestDoorSnapshot,
  getUserNotifications,
  getForumMessages,
  loadPayrollConfig,
  getOfficialPortalDocument,
  getOfficialPortalSnapshot,
  getPortalAutoSyncStatus,
  getPortalSyncJob,
  getUserRelayHours,
  getUserRemateHours,
  getUserManualPremiums,
  loginUser,
  markUserNotificationsRead,
  queuePendingPortalActivation,
  postForumMessage,
  reactivatePortalSync,
  refreshCurrentUser,
  registerUser,
  sendPendingActivationEmails,
  requestOfficialPortalDocument,
  setPortalAutoSync,
  setPortalSecurityKey,
  setUserRelayHour,
  setUserRemateHours,
  setUserManualPremium,
  trackPageVisit,
  touchPortalActivity,
  trackUsageEvent,
  updateUserIrpf,
  updateActivationEmail,
  updateUserProfile,
  updateUserPassword,
  updateUserSpecialties
} from "./supabaseClient.js";
import GeneralBoard from "./GeneralBoard.jsx";
import AdminMonitor from "./AdminMonitor.jsx";
import { companyLogo, fetchGeneralBoard, shipImage } from "./generalBoard.js";
import { currentAssignmentsFromSnapshot } from "./currentAssignments.js";
import { findPartBolsaWorkers, formatFullPartWorkerCode, mergeFullPartSpecialties } from "./fullPartMerge.js";
import { hashForTab, tabFromHash } from "./navigation.js";
import { compareExceptionsDescending } from "./exceptionOrder.js";
import { loadPortalPayrollDocument, portalPayrollFileName } from "./portalDocument.js";

const STORAGE_KEY = "app-cpe-session";
const MONTH_SHORT_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const SPECIALTY_OVERRIDES_KEY = "app-cpe-specialty-overrides";
const THEME_KEY = "app-cpe-theme";
const PORTAL_CREDENTIALS_KEY = "app-cpe-portal-credentials";
const PORTAL_SYNC_TIMINGS_KEY = "app-cpe-portal-sync-timings";
const PORTAL_ACTIVE_SYNC_KEY = "app-cpe-portal-active-sync";
const FORUM_LAST_READ_KEY = "app-cpe-forum-last-read";
const FORUM_INTRO_SEEN_KEY = "app-cpe-forum-intro-seen";
const DEFAULT_PORTAL_SYNC_SECONDS = 55;
const PORTAL_ACTIVE_SYNC_MAX_AGE_MS = 30 * 60 * 1000;
const SNAPSHOT_POLL_MS = 60_000;
const CHAPERO_POLL_MS = 60_000;

function forumStorageKey(prefix, chapa) {
  return `${prefix}:${normalizeChapa(chapa)}`;
}

function getForumLastRead(chapa) {
  try {
    return Number(localStorage.getItem(forumStorageKey(FORUM_LAST_READ_KEY, chapa))) || 0;
  } catch {
    return 0;
  }
}

function markForumRead(chapa, messageId) {
  if (!chapa || !Number.isFinite(Number(messageId))) return;
  try {
    localStorage.setItem(forumStorageKey(FORUM_LAST_READ_KEY, chapa), String(messageId));
  } catch {
    // El aviso volvera a calcularse en la siguiente sesion si no hay almacenamiento.
  }
}

function hasSeenForumIntro(chapa) {
  try {
    return localStorage.getItem(forumStorageKey(FORUM_INTRO_SEEN_KEY, chapa)) === "1";
  } catch {
    return false;
  }
}

function markForumIntroSeen(chapa) {
  try {
    localStorage.setItem(forumStorageKey(FORUM_INTRO_SEEN_KEY, chapa), "1");
  } catch {
    // La tarjeta puede volver a aparecer si no hay almacenamiento disponible.
  }
}

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
    const recentSamples = samples.slice(-3).map(Number).filter(Number.isFinite);
    const average = recentSamples.reduce((sum, value) => sum + value, 0) / recentSamples.length;
    return Math.min(60, Math.max(20, Math.round(average)));
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

const BOTTOM_NAV_ITEMS = [
  { id: "inicio", label: "Inicio", Icon: Home },
  { id: "contratacion", label: "Contratación", Icon: ClipboardList },
  { id: "sueldometro", label: "Sueldómetro", Icon: WalletCards },
  { id: "descansos", label: "Descansos", Icon: CalendarDays },
  { id: "vacaciones", label: "Vacaciones", Icon: Sun }
];

const SIDE_NAV_GROUPS = [
  {
    label: "Operativa",
    items: [
      { id: "estado", label: "Chapero", Icon: BriefcaseBusiness },
      { id: "puertas", label: "Puertas", Icon: CalendarRange },
      { id: "excepciones", label: "Excepciones", Icon: CalendarOff },
      { id: "tablon", label: "Tablón general", Icon: ClipboardList },
      { id: "censo", label: "Censo", Icon: UsersRound }
    ]
  },
  {
    label: "Comunidad",
    items: [
      { id: "foro", label: "Foro", Icon: MessageCircle }
    ]
  },
  {
    label: "Recursos y cuenta",
    items: [
      { id: "nominas", label: "Nóminas", Icon: FileLock2 },
      { id: "enlaces", label: "Enlaces útiles", Icon: LinkIcon }
    ]
  }
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

function removeStoredUserData(chapa) {
  const normalized = normalizeChapa(chapa);
  localStorage.removeItem(STORAGE_KEY);
  if (!normalized) return;
  for (const key of [SPECIALTY_OVERRIDES_KEY, PORTAL_CREDENTIALS_KEY, PORTAL_SYNC_TIMINGS_KEY, PORTAL_ACTIVE_SYNC_KEY]) {
    try {
      const stored = JSON.parse(localStorage.getItem(key)) || {};
      delete stored[normalized];
      if (Object.keys(stored).length) localStorage.setItem(key, JSON.stringify(stored));
      else localStorage.removeItem(key);
    } catch {
      localStorage.removeItem(key);
    }
  }
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
  const [email, setEmail] = useState("");
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

    if (mode === "register" && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Introduce un correo electrónico válido.");
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
          email: email.trim(),
          specialties: detectedSpecialties
        })
        : await loginUser({ chapa: normalized, password });

      if (!response?.token) throw new Error("No se pudo iniciar sesion.");
      if (!response.supportAccess) {
        trackUsageEvent({
          eventType: mode === "register" ? "register" : "login",
          chapa: normalized,
          metadata: { specialties: response.specialties || detectedSpecialties }
        });
      }
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
            autoComplete="username"
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

      {mode === "register" && (
        <label>
          <span>Correo electrónico</span>
          <div className="field">
            <Mail size={18} />
            <input type="email" autoComplete="email" placeholder="tu@correo.com" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
        </label>
      )}

      {mode === "register" && <p className="login-hint">La app detectara tus especialidades por la chapa.</p>}
      {error && <p className="form-error">{error}</p>}

      <button className="primary-button" type="submit" disabled={loading}>
        {loading ? "Procesando..." : mode === "register" ? "Crear cuenta" : "Entrar"}
      </button>
    </form>
  );
}

function AppHeader({ onMenuOpen, unreadNotifications = 0, onNotificationsOpen }) {
  return (
    <header className="app-header">
      <button className="header-menu-button" type="button" onClick={onMenuOpen} aria-label="Abrir menú">
        <Menu size={23} />
      </button>
      <div className="logo-box">
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="App CPE" />
      </div>
      <div className="header-title">
        <strong>App CPE</strong>
      </div>
      <button className="header-notifications-button" type="button" onClick={onNotificationsOpen} aria-label={`Abrir novedades${unreadNotifications ? `, ${unreadNotifications} sin leer` : ""}`}>
        <Bell size={23} />
        {unreadNotifications > 0 && <span>{Math.min(99, unreadNotifications)}</span>}
      </button>
    </header>
  );
}

function SideMenu({ open, activeTab, theme, isAdmin, forumHasUnread, onClose, onNavigate, onProfileOpen, onSettingsOpen, onPortalAccessOpen, onDeleteAccountOpen, onThemeToggle, onLogout }) {
  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;
  const navigate = (tab) => {
    onNavigate(tab);
    onClose();
  };

  return (
    <div className="side-menu-layer">
      <button className="side-menu-overlay" type="button" onClick={onClose} aria-label="Cerrar menú" />
      <aside className="side-menu" aria-label="Menú de navegación">
        <header>
          <div className="side-menu-brand">
            <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="" />
            <span><strong>App CPE</strong></span>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar menú"><X size={21} /></button>
        </header>
        <button className={activeTab === "inicio" ? "side-home-link active" : "side-home-link"} type="button" onClick={() => navigate("inicio")}>
          <Home size={20} /><span>Inicio</span><ChevronRight size={18} />
        </button>
        {SIDE_NAV_GROUPS.map((group) => (
          <section key={group.label}>
            <p>{group.label}</p>
            {group.items.map(({ id, label, Icon }) => (
              <button key={id} className={activeTab === id ? "active" : ""} type="button" onClick={() => navigate(id)}>
                <Icon size={19} /><span>{label}</span>
                <span className="side-nav-trailing">
                  {id === "foro" && forumHasUnread && <span className="side-nav-new-badge">Nuevo</span>}
                  <ChevronRight size={17} />
                </span>
              </button>
            ))}
          </section>
        ))}
        {isAdmin && (
          <section className="side-menu-admin">
            <p>Administración</p>
            <button className={activeTab === "monitor" ? "active" : ""} type="button" onClick={() => navigate("monitor")}>
              <BarChart3 size={19} /><span>Monitor de actividad</span><ChevronRight size={17} />
            </button>
          </section>
        )}
        <section className="side-menu-settings">
          <p>Ajustes</p>
          <button type="button" onClick={() => { onProfileOpen(); onClose(); }}><UserRound size={19} /><span>Nombre y privacidad</span><ChevronRight size={17} /></button>
          <button type="button" onClick={() => { onSettingsOpen(); onClose(); }}><Settings size={19} /><span>Cambiar contraseña</span><ChevronRight size={17} /></button>
          <button type="button" onClick={() => { onPortalAccessOpen(); onClose(); }}><Lock size={19} /><span>Acceso al portal</span><ChevronRight size={17} /></button>
          <button type="button" onClick={onThemeToggle}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}<span>{theme === "dark" ? "Modo claro" : "Modo oscuro"}</span><ChevronRight size={17} /></button>
          <button className="side-delete-account" type="button" onClick={() => { onDeleteAccountOpen(); onClose(); }}><Trash2 size={19} /><span>Eliminar mi cuenta</span><ChevronRight size={17} /></button>
          <button className="side-logout" type="button" onClick={onLogout}><LogOut size={19} /><span>Cerrar sesión</span></button>
        </section>
      </aside>
    </div>
  );
}

function InboxModal({ messages, onClose }) {
  const [selectedMessage, setSelectedMessage] = useState(null);
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
              <button className={message.read ? "is-read" : "is-unread"} key={message.id} type="button" onClick={() => setSelectedMessage(message)}>
                <span><Mail size={17} /></span>
                <div><strong>{message.title}</strong><small>{message.sender || "Portal CPE"}</small></div>
                <time>{message.date}<small>{message.time}</small></time>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        ) : <p className="portal-personal-empty">No hay mensajes disponibles. Actualiza el portal para consultar la bandeja.</p>}
        {selectedMessage && (
          <div className="portal-message-detail" role="dialog" aria-modal="true" aria-labelledby="portal-message-title">
            <header>
              <button type="button" onClick={() => setSelectedMessage(null)} aria-label="Volver a la bandeja"><ChevronRight size={20} /></button>
              <div><small>{selectedMessage.sender || "Portal CPE"}</small><h3 id="portal-message-title">{selectedMessage.title}</h3></div>
              <button type="button" onClick={() => setSelectedMessage(null)} aria-label="Cerrar mensaje"><X size={20} /></button>
            </header>
            <p className="portal-message-date">{selectedMessage.date} · {selectedMessage.time}</p>
            <div className="portal-message-body">{selectedMessage.body || "El portal no ha proporcionado el contenido completo de este mensaje. Vuelve a actualizar para recuperarlo."}</div>
          </div>
        )}
      </section>
    </div>
  );
}

function base64DocumentUrl(contentBase64, mimeType) {
  const binary = window.atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: mimeType || "application/pdf" }));
}

class PayrollDocumentErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, details) {
    console.error("No se pudo mostrar la nomina descargada", error, details);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="document-modal-backdrop" role="presentation">
        <section className="document-modal" role="dialog" aria-modal="true" aria-labelledby="payroll-document-error-title">
          <header>
            <div><small>Nómina electrónica</small><h2 id="payroll-document-error-title">No se pudo mostrar</h2></div>
            <button type="button" onClick={this.props.onClose} aria-label="Cerrar nómina"><X size={21} /></button>
          </header>
          <p className="document-modal-status is-error">
            <CircleAlert size={20} /> La nómina está guardada, pero esta pantalla no pudo abrirla. Cierra y vuelve a intentarlo.
          </p>
        </section>
      </div>
    );
  }
}

function PayrollDocumentModal({ payroll, session, onClose }) {
  const [documentUrl, setDocumentUrl] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Buscando documento seguro...");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const loadDocument = async () => {
      const document = await loadPortalPayrollDocument({
        getDocument: () => getOfficialPortalDocument({ token: session.token, documentId: payroll.id }),
        requestDocument: () => requestOfficialPortalDocument({ token: session.token, documentId: payroll.id }),
        getJob: (jobId) => getPortalSyncJob({ token: session.token, jobId }),
        isActive: () => active,
        onStatus: setStatus
      });
      if (!active) return;
      if (!document?.contentBase64) throw new Error("La descarga de la nómina ha tardado demasiado.");
      objectUrl = base64DocumentUrl(document.contentBase64, document.mimeType);
      setDocumentUrl(objectUrl);
    };
    loadDocument()
      .catch((requestError) => active && setError(requestError.message || "No se pudo abrir la nómina."));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [payroll.id, retryKey, session.token]);

  const retryDocument = () => {
    setError("");
    setStatus("Buscando documento guardado...");
    setRetryKey((current) => current + 1);
  };

  return (
    <div className="document-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="document-modal" role="dialog" aria-modal="true" aria-labelledby="payroll-document-title">
        <header>
          <div><small>Nómina electrónica</small><h2 id="payroll-document-title">{payroll.title}</h2></div>
          {documentUrl && <a href={documentUrl} target="_blank" rel="noreferrer"><ExternalLink size={18} /> Abrir</a>}
          <button type="button" onClick={onClose} aria-label="Cerrar nómina"><X size={21} /></button>
        </header>
        {!documentUrl && !error && <p className="document-modal-status"><RefreshCw className="is-spinning" size={20} /> {status}</p>}
        {error && (
          <div className="document-modal-error">
            <p className="document-modal-status is-error"><CircleAlert size={20} /> {error}</p>
            <button type="button" onClick={retryDocument}><RefreshCw size={17} /> Reintentar</button>
          </div>
        )}
        {documentUrl && (
          <div className="document-modal-download">
            <FileLock2 size={42} />
            <strong>{payroll.title}</strong>
            <span>Documento PDF protegido</span>
            <a href={documentUrl} download={portalPayrollFileName(payroll.title)}><FileDown size={18} /> Descargar nómina</a>
          </div>
        )}
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
  const [loadingPart, setLoadingPart] = useState("");
  const assignments = useMemo(
    () => currentAssignmentsFromSnapshot(snapshot, currentTime),
    [snapshot, currentTime]
  );

  const openAssignment = async (item) => {
    const selectionKey = `${item.parte}|${item.fecha}|${item.jornada}`;
    setLoadingPart(selectionKey);
    let enriched = item;
    try {
      const board = await fetchGeneralBoard();
      const bolsaWorkers = findPartBolsaWorkers(board, item);
      enriched = {
        ...item,
        detail: {
          ...(item.detail || {}),
          specialties: mergeFullPartSpecialties(item.detail?.specialties || [], bolsaWorkers),
        },
      };
    } catch {
      enriched = item;
    } finally {
      setLoadingPart("");
      setSelectedAssignment(enriched);
    }
  };

  if (!assignments.length) {
    const hasPortalData = Boolean(snapshot?.payload);
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
          <div>
            <span>--/--</span>
            <strong>{hasPortalData ? "No hay contrataciones próximas" : "Sin datos cargados"}</strong>
            <small>
              {hasPortalData
                ? "No tienes jornales para hoy ni para días posteriores."
                : "Conecta el portal para consultar tu contratación."}
            </small>
          </div>
          {!hasPortalData && (
            <button type="button" onClick={onLoadPortal}>
              <RefreshCw size={17} />
              Cargar datos
            </button>
          )}
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
              onClick={() => openAssignment(item)}
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
              {loadingPart === `${item.parte}|${item.fecha}|${item.jornada}`
                ? <RefreshCw className="is-spinning" size={18} aria-hidden="true" />
                : <ChevronRight size={18} aria-hidden="true" />}
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

  return (
    <section className={`upcoming-doubles-card${rows.length ? "" : " is-empty"}`}>
      <header>
        <span className="portal-personal-icon is-doubles"><CalendarCheck2 size={21} /></span>
        <div><small>Solicitudes activas</small><strong>Próximos dobles</strong></div>
        <b>{rows.length}</b>
      </header>
      {rows.length ? (
        <div className="portal-doubles-list">
          {rows.map((request, index) => (
            <article key={`${request.date}-${request.specialty}-${request.journey}-${index}`}>
              <time><strong>{request.date.slice(0, 2)}</strong><small>{request.date.slice(3, 5)}</small></time>
              <div>
                <strong>{request.specialty}</strong>
                <small>Jornada {request.journey}</small>
                {request.holiday && <em className="portal-double-holiday">Festivo</em>}
              </div>
              <Check size={17} />
            </article>
          ))}
        </div>
      ) : (
        <div className="portal-doubles-empty">
          <CalendarCheck2 size={20} aria-hidden="true" />
          <div>
            <strong>No hay dobles solicitados próximos</strong>
            <small>No tienes solicitudes de doble pendientes para los próximos días.</small>
          </div>
        </div>
      )}
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
          {specialties.map((specialty) => {
            const workers = Array.isArray(specialty.workers) ? specialty.workers : [];
            const useCompactCodeGrid = workers.length > 0 && workers.every((worker) => !String(worker?.name || "").trim());
            return (
              <article key={specialty.name} className={useCompactCodeGrid ? "is-code-grid" : ""}>
                <header><strong>{specialty.name}</strong><span>{specialty.requested}</span></header>
                <div>
                  {workers.map((worker) => {
                  const isCurrentWorker = normalizeChapa(worker.code) === normalizedCurrentChapa;
                  return (
                    <p
                      key={`${specialty.name}-${worker.code}-${worker.name}`}
                      className={`${isCurrentWorker ? "is-current-worker" : ""}${worker.name ? "" : " is-code-only"}`.trim()}
                    >
                      <b>{formatFullPartWorkerCode(worker.code)}</b>
                      {worker.name && <span>{worker.name}</span>}
                    </p>
                  );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function PortalJornalDetailModal({
  jornal,
  onClose,
  onSetRemateHours,
  savingRemateKey,
  remateError,
  onSetManualPremium,
  onUsePortalPremium,
  savingPremiumKey,
  premiumError
}) {
  const logo = companyLogo(jornal?.empresa);
  const payroll = jornal?.payroll || {};
  const [manualPremiumInput, setManualPremiumInput] = useState("");
  const [manualPremiumInputError, setManualPremiumInputError] = useState("");

  useEffect(() => {
    setManualPremiumInput(payroll.manualPrima == null ? "" : Number(payroll.manualPrima).toFixed(2).replace(".", ","));
    setManualPremiumInputError("");
  }, [payroll.manualPremiumKey, payroll.manualPrima]);

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
          {payroll.continuousDoubleMeal > 0 && (
            <div><span>Manutención doble · {payroll.continuousDoubleMealHours}</span><strong>{formatEuro(payroll.continuousDoubleMeal)}</strong></div>
          )}
          {payroll.remate > 0 && (
            <div><span>Remate · {payroll.remateHours} {payroll.remateHours === 1 ? "hora" : "horas"}</span><strong>{formatEuro(payroll.remate)}</strong></div>
          )}
          {payroll.relayHourEnabled && (
            <div><span>Hora de relevo</span><strong>{formatEuro(payroll.relayHour)}</strong></div>
          )}
          {payroll.primaEligible && (
            <div className={payroll.manualPremiumConflict || payroll.primaVerification === "pending" ? "is-unverified-prima" : undefined}>
              <span>{payroll.primaSource === "manual" ? "Prima manual" : "Prima"}</span><strong>{payroll.prima != null ? formatEuro(payroll.prima) : "Pendiente"}</strong>
            </div>
          )}
        </div>
        {payroll.manualPremiumEligible && (
          <div className={`portal-manual-premium${payroll.manualPremiumConflict ? " has-conflict" : ""}`}>
            <div className="portal-manual-premium-heading">
              <div><span>Prima de producción</span><strong>{payroll.primaSource === "manual" ? "Corrección manual activa" : payroll.portalPrima == null ? "Pendiente del portal" : "Importe oficial"}</strong></div>
              <em className={`is-${payroll.primaSource}`}>{payroll.primaSource === "manual" ? "Manual" : payroll.portalPrima == null ? "Pendiente" : "Portal"}</em>
            </div>
            <div className="portal-manual-premium-values">
              <span>Portal <strong>{payroll.portalPrima == null ? "Pendiente" : formatEuro(payroll.portalPrima)}</strong></span>
              <span>Utilizada <strong>{payroll.prima == null ? formatEuro(0) : formatEuro(payroll.prima)}</strong></span>
            </div>
            {payroll.manualPremiumConflict && (
              <div className="portal-manual-premium-warning" role="alert">
                <CircleAlert size={19} />
                <span><strong>El portal ha publicado un importe diferente.</strong> Revisa cuál quieres utilizar en el Sueldómetro.</span>
              </div>
            )}
            <form onSubmit={(event) => {
              event.preventDefault();
              const normalized = Number(String(manualPremiumInput).trim().replace(",", "."));
              if (Number.isFinite(normalized) && normalized >= 0 && normalized <= 99999.99) {
                setManualPremiumInputError("");
                onSetManualPremium?.(jornal, normalized);
              } else {
                setManualPremiumInputError("Introduce un importe válido entre 0 y 99.999,99 €.");
              }
            }}>
              <label htmlFor={`manual-premium-${payroll.manualPremiumKey}`}>
                Prima manual
                <span><input id={`manual-premium-${payroll.manualPremiumKey}`} inputMode="decimal" autoComplete="off" value={manualPremiumInput} onChange={(event) => { setManualPremiumInput(event.target.value.replace(/[^0-9.,]/g, "")); setManualPremiumInputError(""); }} placeholder={payroll.portalPrima == null ? "Ej. 42,50" : String(payroll.portalPrima).replace(".", ",")} /><b>€</b></span>
              </label>
              <button type="submit" disabled={savingPremiumKey === payroll.manualPremiumKey || !manualPremiumInput.trim()}>Guardar prima manual</button>
            </form>
            {manualPremiumInputError && <small className="portal-remate-error" role="alert">{manualPremiumInputError}</small>}
            <small>La cantidad manual se usa en el cálculo sin modificar el dato original del portal.</small>
            {payroll.manualPrima != null && (
              <div className="portal-manual-premium-actions">
                {payroll.manualPremiumConflict && <button type="button" disabled={savingPremiumKey === payroll.manualPremiumKey} onClick={() => onSetManualPremium?.(jornal, payroll.manualPrima)}>Mantener {formatEuro(payroll.manualPrima)}</button>}
                <button type="button" disabled={savingPremiumKey === payroll.manualPremiumKey} onClick={() => onUsePortalPremium?.(jornal)}>{payroll.portalPrima == null ? "Eliminar prima manual" : `Usar ${formatEuro(payroll.portalPrima)} del portal`}</button>
              </div>
            )}
            {savingPremiumKey === payroll.manualPremiumKey && <small className="portal-remate-status">Guardando prima…</small>}
            {premiumError && <small className="portal-remate-error" role="alert">{premiumError}</small>}
          </div>
        )}
        {payroll.remateEligible && (
          <div className="portal-remate-selector">
            <div>
              <span>Remate</span>
              <strong>Grupo {payroll.remateGroup} · {formatEuro(payroll.remateHourlyRate)} por hora</strong>
            </div>
            <div className="portal-remate-options" role="group" aria-label="Horas de remate">
              {[0, 1, 2].map((hours) => (
                <button
                  key={hours}
                  type="button"
                  className={payroll.remateHours === hours ? "is-active" : ""}
                  disabled={savingRemateKey === payroll.remateKey}
                  onClick={() => onSetRemateHours?.(jornal, hours)}
                >
                  <span>{hours === 0 ? "Sin remate" : `${hours} ${hours === 1 ? "hora" : "horas"}`}</span>
                  <small>{hours === 0 ? formatEuro(0) : formatEuro(payroll.remateHourlyRate * hours)}</small>
                </button>
              ))}
            </div>
            {savingRemateKey === payroll.remateKey && <small className="portal-remate-status">Guardando…</small>}
            {remateError && <small className="portal-remate-error" role="alert">{remateError}</small>}
          </div>
        )}
      </section>
    </div>
  );
}

function ChangePasswordModal({ onClose, onSave }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!currentPassword) {
      setError("Introduce tu contraseña actual.");
      return;
    }
    if (newPassword.length < 4) {
      setError("La nueva contraseña debe tener al menos 4 caracteres.");
      return;
    }
    if (newPassword !== confirmation) {
      setError("Las contraseñas nuevas no coinciden.");
      return;
    }

    try {
      setLoading(true);
      await onSave({ currentPassword, newPassword });
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
    } catch (requestError) {
      setError(requestError.message || "No se pudo cambiar la contraseña.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inbox-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="inbox-modal password-modal" role="dialog" aria-modal="true" aria-label="Cambiar contraseña">
        <header>
          <span><Lock size={20} /></span>
          <div>
            <small>Mi cuenta</small>
            <h2>Cambiar contraseña</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>

        {saved ? (
          <div className="password-change-success">
            <Check size={24} />
            <strong>Contraseña actualizada</strong>
            <span>Ya puedes utilizar la nueva contraseña la próxima vez que entres.</span>
            <button className="primary-button" type="button" onClick={onClose}>Cerrar</button>
          </div>
        ) : (
          <form className="password-change-form" onSubmit={submit}>
            <label>
              <span>Contraseña actual</span>
              <input
                autoFocus
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              <span>Nueva contraseña</span>
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              <span>Repite la nueva contraseña</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar nueva contraseña"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

function ProfileSettingsModal({ session, onClose, onSave }) {
  const [displayName, setDisplayName] = useState(String(session?.displayName || ""));
  const [forumShowChapa, setForumShowChapa] = useState(Boolean(session?.forumShowChapa));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const submit = async (event) => {
    event.preventDefault();
    const normalizedName = displayName.trim().replace(/\s+/g, " ");
    setError("");
    setSaved(false);
    if (normalizedName.length < 1 || normalizedName.length > 40) {
      setError("El nombre debe tener entre 1 y 40 caracteres.");
      return;
    }
    try {
      setLoading(true);
      await onSave({ displayName: normalizedName, forumShowChapa });
      setDisplayName(normalizedName);
      setSaved(true);
    } catch (requestError) {
      setError(requestError.message || "No se pudo guardar el perfil.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inbox-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="inbox-modal password-modal profile-settings-modal" role="dialog" aria-modal="true" aria-label="Nombre y privacidad">
        <header>
          <span><UserRound size={21} /></span>
          <div><small>Mi perfil</small><h2>Nombre y privacidad</h2></div>
          <button type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <form className="password-change-form profile-settings-form" onSubmit={submit}>
          <label>
            <span>Nombre visible</span>
            <input
              autoFocus
              type="text"
              maxLength={40}
              autoComplete="name"
              placeholder="Cómo quieres que te llamemos"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <small>Se mostrará en Inicio y junto a tus mensajes del foro.</small>
          </label>
          <label className="profile-privacy-toggle">
            <input
              type="checkbox"
              checked={forumShowChapa}
              onChange={(event) => setForumShowChapa(event.target.checked)}
            />
            <span>
              <strong>Mostrar mi chapa en el foro</strong>
              <small>Si la activas, aparecerá un badge «Chapa {session?.chapa}» junto a tu nombre.</small>
            </span>
          </label>
          {error && <p className="form-error">{error}</p>}
          {saved && <p className="profile-settings-saved"><Check size={15} /> Perfil actualizado</p>}
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Guardando..." : "Guardar cambios"}
          </button>
        </form>
      </section>
    </div>
  );
}

function DeleteAccountModal({ chapa, onClose, onDelete }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [loading, onClose]);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!currentPassword) {
      setError("Introduce tu contraseña actual.");
      return;
    }
    if (confirmation.trim().toUpperCase() !== "ELIMINAR") {
      setError("Escribe ELIMINAR para confirmar la baja definitiva.");
      return;
    }

    try {
      setLoading(true);
      await onDelete({ currentPassword, confirmation: "ELIMINAR" });
    } catch (requestError) {
      setError(requestError.message || "No se pudo eliminar la cuenta.");
      setLoading(false);
    }
  };

  return (
    <div className="inbox-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !loading && onClose()}>
      <section className="inbox-modal password-modal delete-account-modal" role="dialog" aria-modal="true" aria-label="Eliminar cuenta definitivamente">
        <header>
          <span><Trash2 size={20} /></span>
          <div>
            <small>Mi cuenta</small>
            <h2>Eliminar cuenta definitivamente</h2>
          </div>
          <button type="button" onClick={onClose} disabled={loading} aria-label="Cerrar"><X size={20} /></button>
        </header>

        <form className="password-change-form" onSubmit={submit}>
          <div className="delete-account-warning">
            <CircleAlert size={24} />
            <div>
              <strong>Esta acción no se puede deshacer</strong>
              <span>Se borrarán la cuenta de la chapa {chapa}, sus sesiones, credenciales, jornales, primas, nóminas, documentos y datos de actividad.</span>
            </div>
          </div>
          <label>
            <span>Contraseña actual</span>
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            <span>Escribe ELIMINAR para confirmar</span>
            <input
              type="text"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="delete-account-button" type="submit" disabled={loading || confirmation.trim().toUpperCase() !== "ELIMINAR"}>
            {loading ? "Eliminando todos los datos..." : "Eliminar definitivamente"}
          </button>
        </form>
      </section>
    </div>
  );
}

function PortalMonthDetailModal({ month, irpfRate, onClose, onToggleRelayHour, onOpenJornal, savingRelayHourKey, relayHourError }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("month");
  const allRows = useMemo(
    () => [...(month?.enriched || [])].sort(compareJornalesDescending),
    [month]
  );
  const periodSummary = useMemo(() => summarizePayroll(allRows), [allRows]);
  const rows = useMemo(
    () => filterJornalesByPeriod(allRows, selectedPeriod),
    [allRows, selectedPeriod]
  );
  const selectedPeriodLabel = selectedPeriod === "first"
    ? "1.ª quincena"
    : selectedPeriod === "second" ? "2.ª quincena" : "mes completo";
  const totals = useMemo(() => rows.reduce((summary, item) => ({
    base: summary.base + Number(item.payroll?.base || 0),
    complement: summary.complement + Number(item.payroll?.complement || 0),
    meal: summary.meal + Number(item.payroll?.continuousDoubleMeal || 0),
    remate: summary.remate + Number(item.payroll?.remate || 0),
    prima: summary.prima + Number(item.payroll?.prima || 0),
    relay: summary.relay + Number(item.payroll?.relayHour || 0),
    gross: summary.gross + Number(item.payroll?.total || 0)
  }), { base: 0, complement: 0, meal: 0, remate: 0, prima: 0, relay: 0, gross: 0 }), [rows]);
  const withholding = totals.gross * (Number(irpfRate || 0) / 100);
  const net = totals.gross - withholding;

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

  if (!month) return null;

  const downloadPdf = async () => {
    setDownloading(true);
    setDownloadError("");
    try {
      const { downloadMonthlyPayrollPdf } = await loadMonthlyPayrollPdfModule();
      downloadMonthlyPayrollPdf({
        ...month,
        monthLabel: `${month.monthLabel} · ${selectedPeriodLabel}`,
        enriched: rows
      }, irpfRate);
    } catch (error) {
      console.error("No se pudo generar el PDF mensual:", error);
      setDownloadError("No se pudo descargar el PDF. Vuelve a intentarlo.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="portal-month-detail-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="portal-month-detail-modal" role="dialog" aria-modal="true" aria-label={`Resumen de ${month.monthLabel}`}>
        <header>
          <span><CalendarRange size={25} /></span>
          <div><small>Resumen mensual</small><h1>{month.monthLabel}</h1></div>
          <button className="portal-month-download" type="button" disabled={downloading} onClick={downloadPdf}>
            {downloading ? <RefreshCw className="is-spinning" size={18} /> : <FileDown size={18} />}
            <b>{downloading ? "Generando..." : "Descargar PDF"}</b>
          </button>
          <button type="button" onClick={onClose} title="Cerrar"><X size={22} /></button>
        </header>
        {downloadError && <p className="portal-month-download-error">{downloadError}</p>}
        {relayHourError && <p className="portal-relay-hour-error"><CircleAlert size={15} /> {relayHourError}</p>}
        <div className="portal-month-financials">
          <div className="is-gross"><span>Bruto</span><strong>{formatEuro(totals.gross)}</strong></div>
          <div><span>Retención · {irpfRate}%</span><strong>-{formatEuro(withholding)}</strong></div>
          <div className="is-net"><span>Neto estimado</span><strong>{formatEuro(net)}</strong></div>
        </div>
        <div className="portal-month-period-selector" aria-label="Periodo del resumen mensual">
          <button className={selectedPeriod === "first" ? "is-active" : ""} type="button" onClick={() => setSelectedPeriod("first")}>
            <span>1.ª quincena</span><strong>{formatEuro(periodSummary.firstHalf)}</strong>
          </button>
          <button className={selectedPeriod === "second" ? "is-active" : ""} type="button" onClick={() => setSelectedPeriod("second")}>
            <span>2.ª quincena</span><strong>{formatEuro(periodSummary.secondHalf)}</strong>
          </button>
          <button className={selectedPeriod === "month" ? "is-active" : ""} type="button" onClick={() => setSelectedPeriod("month")}>
            <span>Mes completo</span><strong>{formatEuro(periodSummary.total)}</strong>
          </button>
        </div>
        <div className="portal-month-breakdown">
          <div><span>Jornales</span><strong>{rows.filter((item) => !item.isVacation).length}</strong></div>
          {rows.some((item) => item.isVacation) && <div><span>Días VA</span><strong>{rows.filter((item) => item.isVacation).length}</strong></div>}
          <div><span>Bases</span><strong>{formatEuro(totals.base)}</strong></div>
          <div><span>Complementos</span><strong>{formatEuro(totals.complement)}</strong></div>
          {totals.meal > 0 && <div><span>Manutención dobles</span><strong>{formatEuro(totals.meal)}</strong></div>}
          {totals.remate > 0 && <div><span>Remates</span><strong>{formatEuro(totals.remate)}</strong></div>}
          <div><span>Primas</span><strong>{formatEuro(totals.prima)}</strong></div>
          <div><span>Horas relevo</span><strong>{formatEuro(totals.relay)}</strong></div>
        </div>
        <div className="portal-month-jornales">
          <h2>Jornales · {selectedPeriodLabel}</h2>
          {rows.length === 0 && <p>No hay jornales cargados en este periodo.</p>}
          {rows.map((item, index) => (
            <article
              key={`${item.jornal || item.parte || item.dia}-${index}`}
              className={item.isVacation ? "is-vacation" : undefined}
              role={item.isVacation ? undefined : "button"}
              tabIndex={item.isVacation ? undefined : 0}
              aria-label={item.isVacation ? undefined : `Abrir jornal del ${item.dia || "día seleccionado"}`}
              onClick={item.isVacation ? undefined : () => onOpenJornal?.(item)}
              onKeyDown={item.isVacation ? undefined : (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenJornal?.(item);
                }
              }}
            >
              <div className="portal-month-jornal-heading">
                <span><b>{item.dia || "-"}</b><small>{item.isVacation ? "VA" : (item.payroll?.shift || "Jornal")}</small></span>
                <div><strong>{item.isVacation ? "Vacaciones" : (item.especialidad || "Jornal")}</strong><small>{item.isVacation ? "Día de vacaciones retribuido" : [item.buque, item.empresa].filter((value) => value && !/^(?:--?|—)$/.test(String(value).trim())).join(" · ")}</small></div>
                <strong>{formatEuro(item.payroll?.total)}</strong>
              </div>
              <div className="portal-month-jornal-values">
                <span>{item.isVacation ? "Importe" : "Base"} <b>{formatEuro(item.payroll?.base)}</b></span>
                {!item.isVacation && <span>Complemento <b>{formatEuro(item.payroll?.complement || 0)}</b></span>}
                {!item.isVacation && item.payroll?.continuousDoubleMeal > 0 && (
                  <span>Manutención doble · {item.payroll.continuousDoubleMealHours} <b>{formatEuro(item.payroll.continuousDoubleMeal)}</b></span>
                )}
                {!item.isVacation && item.payroll?.remate > 0 && (
                  <span>Remate · {item.payroll.remateHours} {item.payroll.remateHours === 1 ? "hora" : "horas"} <b>{formatEuro(item.payroll.remate)}</b></span>
                )}
                {!item.isVacation && item.payroll?.primaEligible && (
                  <span className={item.payroll?.manualPremiumConflict || item.payroll?.primaVerification === "pending" ? "is-unverified-prima" : undefined}>
                    {item.payroll?.primaSource === "manual" ? "Prima manual" : "Prima"} <b>{item.payroll?.prima != null ? formatEuro(item.payroll.prima) : "Pendiente"}</b>
                  </span>
                )}
              </div>
              {item.payroll?.relayHourEligible && (
                <label className={`portal-relay-hour${item.payroll.relayHourEnabled ? " is-enabled" : ""}`} onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={item.payroll.relayHourEnabled}
                    disabled={Boolean(savingRelayHourKey)}
                    onChange={(event) => onToggleRelayHour(item, event.target.checked)}
                  />
                  <span>
                    Hora de relevo
                    <small>{item.payroll.relayHourRateKey === "FESTIVO" ? "Festiva" : "Laborable"} · +{formatEuro(item.payroll.relayHourRate)}</small>
                  </span>
                </label>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function portalFirstName(snapshot) {
  const fullName = String(snapshot?.payload?.descansos?.worker?.name || "").trim();
  if (!fullName) return "";
  const [firstName] = fullName.split(/\s+/);
  return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLocaleLowerCase("es");
}

function preferredFirstName(displayName, snapshot) {
  const firstName = String(displayName || "").trim().split(/\s+/)[0];
  if (!firstName) return portalFirstName(snapshot);
  if (firstName === firstName.toLocaleUpperCase("es")) {
    return firstName.charAt(0).toLocaleUpperCase("es") + firstName.slice(1).toLocaleLowerCase("es");
  }
  return firstName;
}

function hasRejectedPortalCredentials(snapshotOrMessage) {
  const message = typeof snapshotOrMessage === "string"
    ? snapshotOrMessage
    : snapshotOrMessage?.payload?.sync?.error;
  return /usuario\s+o\s+contrase(?:n|ñ)a\s+del\s+portal\s+oficial\s+incorrectos/i.test(String(message || ""));
}

function PortalConnectCallout({ compact = false, onConnect }) {
  return (
    <button className={`home-connect-callout${compact ? " compact" : ""}`} type="button" onClick={onConnect}>
      <span className="home-connect-icon"><RefreshCw size={22} /></span>
      <span>
        <small>Activa toda la aplicación</small>
        <strong>Conecta tu Portal CPE</strong>
        <span>Introduce tu contraseña del portal de SEVASA para cargar contratación, sueldo, descansos, excepciones y vacaciones.</span>
      </span>
      <ChevronRight size={21} />
    </button>
  );
}

function HomeInitialLoading() {
  return (
    <section className="page-panel home-dashboard home-initial-loading" aria-busy="true" aria-live="polite">
      <div className="home-loading-card">
        <RefreshCw className="is-spinning" size={25} aria-hidden="true" />
        <div>
          <strong>Cargando tu inicio</strong>
          <span>Estamos preparando tu contratación y tus datos.</span>
        </div>
      </div>
      <div className="home-loading-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

function HomePanel({
  user,
  doors,
  doorConfig,
  currentTime,
  portalSnapshot,
  portalConnected,
  notice,
  activeSpecialty,
  availableSpecialties,
  activeSpecialtyId,
  onSpecialtyChange,
  onLoadPortal,
  onNavigate,
  showForumIntro,
  displayName
}) {
  const nearest = getNearestDoor(doors);
  const firstName = preferredFirstName(displayName, portalSnapshot);
  const hasPortalData = Boolean(portalSnapshot?.payload);
  const directAccess = [
    { id: "sueldometro", title: "Sueldómetro", Icon: WalletCards, tone: "salary" },
    { id: "descansos", title: "Descansos", Icon: CalendarDays, tone: "rests" },
    { id: "excepciones", title: "Excepciones", Icon: CalendarOff, tone: "exceptions" },
    { id: "vacaciones", title: "Vacaciones", Icon: Sun, tone: "holidays" }
  ];

  return (
    <section className="page-panel home-dashboard">
      <header className="home-welcome">
        <small>{formatCurrentDateTime(currentTime)}</small>
        <h1>{firstName ? `Hola, ${firstName}` : "Bienvenido/a"}</h1>
        {!hasPortalData && <span className="home-demo-badge">Vista previa · faltan datos del portal</span>}
      </header>

      {portalConnected === false && <PortalConnectCallout onConnect={onLoadPortal} />}

      {showForumIntro && (
        <button className="home-forum-callout" type="button" onClick={() => onNavigate("foro")}>
          <span className="home-forum-icon"><MessageCircle size={23} /></span>
          <span>
            <small>Nuevo en App CPE</small>
            <strong>Foro</strong>
            <span>Comparte avisos, dudas y comentarios con tus compañeros.</span>
          </span>
          <ChevronRight size={21} />
        </button>
      )}

      <section className="home-section-block">
        <div className="home-section-heading">
          <span><ClipboardList size={18} /> Mi contratación</span>
          <button type="button" onClick={() => onNavigate("contratacion")}>Ver todo <ChevronRight size={16} /></button>
        </div>
        <CurrentAssignments snapshot={portalSnapshot} currentTime={currentTime} onLoadPortal={onLoadPortal} />
        <UpcomingDoubles snapshot={portalSnapshot} currentTime={currentTime} />
      </section>

      <section className="home-section-block home-doors-preview">
        <div className="home-section-heading has-select">
          <span><CalendarRange size={18} /> Tu posición frente a las puertas</span>
          <select aria-label="Especialidad" value={activeSpecialtyId} onChange={(event) => onSpecialtyChange(event.target.value)}>
            {availableSpecialties.map((item) => (
              <option key={item.id} value={item.id}>{getSpecialtyLabel(item)}</option>
            ))}
          </select>
        </div>
        <div className="home-door-summary">
          <div>
            <small>Tu posición</small>
            <strong>{user?.displayPosition || user?.position || "--"}<span> / {activeSpecialty.censo.length}</span></strong>
            <em>Chapa {user?.chapa || "-"}</em>
          </div>
          <div>
            <small>Puerta más cercana</small>
            <strong>{nearest?.distance === null || nearest?.distance === undefined ? "--" : formatDistance(nearest.distance)}</strong>
            <em>{nearest?.label || "Sin datos"}</em>
          </div>
        </div>
        <DoorRingsGrid user={user} doors={doors} total={activeSpecialty.censo.length} />
        <button className="home-inline-link" type="button" onClick={() => onNavigate("puertas")}>Ver detalle de puertas <ChevronRight size={17} /></button>
      </section>

      <section className="home-section-block home-direct-access">
        <div className="home-section-heading"><span>Accesos directos</span></div>
        <div className="home-access-list">
          {directAccess.map(({ id, title, Icon, tone }) => (
            <button key={id} className={`home-access-card ${tone}`} type="button" onClick={() => onNavigate(id)}>
              <span><Icon size={23} /></span>
              <span><strong>{title}</strong></span>
              <ChevronRight size={20} />
            </button>
          ))}
        </div>
      </section>

      {notice && <p className="inline-notice">{notice}</p>}
    </section>
  );
}

function OperationalStatusPanel({ user, doors, doorConfig, chaperoSnapshot, chaperoWorker, chaperoLoading, currentTime, activeSpecialty, availableSpecialties, activeSpecialtyId, onSpecialtyChange }) {
  const nearest = getNearestDoor(doors);
  const showRollOnAlert = activeSpecialty.id === "pol-especialista" && nearest?.distance !== null && nearest?.distance < 50;
  return (
    <section className="page-panel">
      <div className="section-heading"><p>Chapero y posición</p><h1>Estado operativo</h1></div>
      <section className={`chapero-card ${chaperoLoading ? "loading" : chaperoWorker?.status || "empty"}`}>
        <div className="jornada-card"><span>Última jornada contratada</span><strong>{formatJornadaContratada(chaperoSnapshot, chaperoLoading)}</strong></div>
        <div className="chapero-meta-row"><span>{formatCurrentDateTime(currentTime)}</span><small>Chapa {user?.chapa || "-"}</small></div>
        <div className="chapero-status-row"><div className="chapero-status-copy"><span>Estado:</span><strong>{formatChaperoStatus(chaperoWorker?.status, chaperoLoading)}</strong></div></div>
        <div className="chapero-summary">
          <div><strong>{chaperoLoading ? "..." : chaperoSnapshot?.summary?.contratado ?? "-"}</strong><span>Contr.</span></div>
          <div><strong>{chaperoLoading ? "..." : chaperoSnapshot?.summary?.anticipado ?? "-"}</strong><span>Ant.</span></div>
          <div><strong>{chaperoLoading ? "..." : chaperoSnapshot?.summary?.nocontratado ?? "-"}</strong><span>No cont.</span></div>
          <div><strong>{chaperoLoading ? "..." : chaperoSnapshot?.summary?.falta ?? "-"}</strong><span>N.D.</span></div>
        </div>
        <div className="chapero-updated"><Clock3 size={14} /><span>{chaperoLoading ? "Cargando Chapero..." : `Actualizado: ${formatUpdatedAt(chaperoSnapshot?.updatedAt)}`}</span></div>
      </section>
      <div className="specialty-select"><span>Especialidad</span><select value={activeSpecialtyId} onChange={(event) => onSpecialtyChange(event.target.value)}>{availableSpecialties.map((item) => <option key={item.id} value={item.id}>{getSpecialtyLabel(item)}</option>)}</select></div>
      <div className="home-summary"><div><p>Tu posición</p><h1>{user?.displayPosition || user?.position || "-"} / {activeSpecialty.censo.length}</h1><span>Chapa {user?.chapa || "-"}</span></div></div>
      {showRollOnAlert && <div className="rollon-alert"><div className="rollon-alert-icon"><CircleAlert size={20} /></div><div><span>Estiba cerca</span><strong>Puerta a {formatDistance(nearest.distance)}</strong><small>Si el doble se pone a las 18:00 o 19:00, la opción de salir de roll-on es alta.</small></div></div>}
      <DoorRingsGrid user={user} doors={doors} total={activeSpecialty.censo.length} />
    </section>
  );
}

function ContractingPanel({ snapshot, currentTime, portalConnected, onLoadPortal }) {
  return (
    <section className="page-panel personal-route-panel">
      <div className="section-heading"><p>Próximos días</p><h1>Mi contratación</h1></div>
      {portalConnected === false && <PortalConnectCallout compact onConnect={onLoadPortal} />}
      <CurrentAssignments snapshot={snapshot} currentTime={currentTime} onLoadPortal={onLoadPortal} />
      <UpcomingDoubles snapshot={snapshot} currentTime={currentTime} />
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

function DoorsPanel({
  doors,
  doorConfig,
  activeSpecialty,
  activeSpecialtyId,
  availableSpecialties,
  onSpecialtyChange
}) {
  const laborableDoors = doors.filter((door) => door.dayType === "laborable");
  const festivoDoors = doors.filter((door) => door.dayType === "festivo");

  return (
    <section className="page-panel">
      <div className="specialty-select doors-specialty-select">
        <span>Especialidad</span>
        <select
          aria-label="Seleccionar puertas por especialidad"
          value={activeSpecialtyId}
          onChange={(event) => onSpecialtyChange(event.target.value)}
        >
          {availableSpecialties.map((item) => (
            <option key={item.id} value={item.id}>{getSpecialtyLabel(item)}</option>
          ))}
        </select>
      </div>
      <div className="section-heading">
        <p>Puertas de turno</p>
        <h1>{getSpecialtyLabel(activeSpecialty)}</h1>
        <span>Censo: {activeSpecialty.censo.length}</span>
      </div>
      <DoorsTable title="Laborables" doors={laborableDoors} tone="lab" />
      <DoorsTable title="Festivas" doors={festivoDoors} tone="fes" />
    </section>
  );
}

function CensoPanel({
  user,
  doors,
  activeSpecialty,
  activeSpecialtyId,
  availableSpecialties,
  onSpecialtyChange
}) {
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
      <div className="specialty-select censo-specialty-select">
        <span>Especialidad</span>
        <select
          aria-label="Seleccionar censo por especialidad"
          value={activeSpecialtyId}
          onChange={(event) => {
            setQuery("");
            onSpecialtyChange(event.target.value);
          }}
        >
          {availableSpecialties.map((item) => (
            <option key={item.id} value={item.id}>{getSpecialtyLabel(item)}</option>
          ))}
        </select>
      </div>
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
      <a className="portal-official-action" href="https://portal.cpevalencia.com/#User" target="_blank" rel="noreferrer">
        Gestionar vacaciones en el Portal <ExternalLink size={15} />
      </a>
    </section>
  );
}

function formatExceptionDate(value) {
  const date = parsePortalDate(value);
  if (!date) return String(value || "—");
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date).replace(" de ", " ");
}

function formatExceptionShift(value) {
  const match = String(value || "").match(/(?:DE\s*)?(\d{1,2})\s*A\s*(\d{1,2})/i);
  return match ? `${match[1].padStart(2, "0")}:00–${match[2].padStart(2, "0")}:00` : String(value || "Jornada");
}

function PortalExceptionsPreview({ exceptions }) {
  if (!exceptions?.recognized) return null;
  const rows = [...(exceptions.rows || [])].sort(compareExceptionsDescending);
  const maxAnnual = Math.max(1, Number(exceptions.maxAnnual) || 15);
  const usedTotal = Math.max(0, Number(exceptions.usedTotal) || 0);
  const remaining = Math.max(0, Number.isFinite(Number(exceptions.remaining)) ? Number(exceptions.remaining) : maxAnnual - usedTotal);
  const progress = Math.min(100, (usedTotal / maxAnnual) * 100);
  const rules = exceptions.rules?.length ? exceptions.rules : [
    "Puedes solicitar hasta 15 excepciones de jornada al año sin necesidad de justificarlas.",
    "En un mismo día puedes pedir un máximo de dos jornadas.",
    "No están disponibles en sábados, domingos, festivos ni días sin las cuatro jornadas principales.",
    "Debes gestionarlas con al menos dos días laborables de antelación."
  ];

  return (
    <section className="portal-exceptions-card">
      <header className="portal-exceptions-hero">
        <div className="portal-exceptions-title">
          <span><CalendarOff size={23} /></span>
          <div><small>Bolsa anual {exceptions.year || new Date().getFullYear()}</small><h1>Mis excepciones</h1></div>
        </div>
        <div className="portal-exceptions-balance"><strong>{remaining}</strong><span>disponibles</span></div>
      </header>

      <div className="portal-exceptions-summary">
        <div><span>Utilizadas</span><strong>{usedTotal}<small> / {maxAnnual}</small></strong></div>
        <div><span>Solicitadas</span><strong>{rows.length}</strong></div>
        <div><span>Aceptadas</span><strong>{rows.filter((row) => /aceptad/i.test(row.status)).length}</strong></div>
      </div>
      <div className="portal-exceptions-progress" aria-label={`${usedTotal} excepciones utilizadas de ${maxAnnual}`}><i style={{ width: `${progress}%` }} /></div>

      <div className="portal-exceptions-heading"><div><small>Historial</small><h2>Excepciones solicitadas</h2></div><span>{rows.length}</span></div>
      {rows.length ? (
        <div className="portal-exceptions-list">
          {rows.map((item, index) => (
            <article key={`${item.date}-${item.shift}-${index}`} className={item.used ? "is-used" : ""}>
              <time><strong>{formatExceptionDate(item.date)}</strong><small>Pedida {formatExceptionDate(item.requestedAt)}</small></time>
              <div><strong>{formatExceptionShift(item.shift)}</strong><span className={/aceptad/i.test(item.status) ? "is-accepted" : ""}>{item.status || "Pendiente"}</span></div>
              <em>{item.used ? <><Check size={13} /> Utilizada</> : "Disponible"}</em>
            </article>
          ))}
        </div>
      ) : <p className="portal-exceptions-empty">Todavía no tienes excepciones solicitadas este año.</p>}

      <section className="portal-exceptions-info">
        <header><Info size={18} /><div><small>Información importante</small><strong>Cómo funciona la bolsa</strong></div></header>
        <ul>{rules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
        <a href="https://portal.cpevalencia.com/#User,ViewNoray,17" target="_blank" rel="noreferrer">Gestionar excepciones en el Portal <ExternalLink size={15} /></a>
      </section>
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
      <a className="portal-official-action" href={annualRestCalendarUrl} target="_blank" rel="noreferrer">
        Abrir Calendario Anual <ExternalLink size={15} />
      </a>
      <a className="portal-official-action" href="https://portal.cpevalencia.com/#User" target="_blank" rel="noreferrer">
        Gestionar descansos en el Portal <ExternalLink size={15} />
      </a>
    </section>
  );
}

function PortalFeatureTemplate({ view = "all" }) {
  const templates = {
    salary: { Icon: WalletCards, eyebrow: "Estimación mensual", title: "Tu Sueldómetro", copy: "Aquí verás el neto estimado, tus jornales y el resumen anual.", labels: ["Neto estimado", "Jornales del mes", "Resumen anual"] },
    rests: { Icon: CalendarDays, eyebrow: "Calendario personal", title: "Tus descansos", copy: "Aquí aparecerán tus días DS, solicitudes SL y la posición correspondiente.", labels: ["Calendario de descansos", "Días SL", "Posiciones SL"] },
    exceptions: { Icon: CalendarOff, eyebrow: "Bolsa anual", title: "Tus excepciones", copy: "Aquí podrás consultar las jornadas solicitadas, utilizadas y disponibles.", labels: ["Disponibles", "Utilizadas", "Solicitadas"] },
    holidays: { Icon: Sun, eyebrow: "Planificación anual", title: "Tus vacaciones", copy: "Aquí podrás consultar los periodos reconocidos y su calendario.", labels: ["Días concedidos", "Próximo periodo", "Calendario"] },
    payrolls: { Icon: FileLock2, eyebrow: "Documentos personales", title: "Tus nóminas", copy: "Aquí podrás consultar y abrir tus nóminas electrónicas.", labels: ["Última nómina", "Periodo", "Documentos"] },
    all: { Icon: BriefcaseBusiness, eyebrow: "Datos personales", title: "Todo listo para empezar", copy: "Conecta el portal para cargar contratación, sueldo, descansos, vacaciones y nóminas.", labels: ["Contratación", "Sueldómetro", "Calendarios"] }
  };
  const template = templates[view] || templates.all;
  const Icon = template.Icon;
  return (
    <section className={`portal-feature-template ${view}`} aria-label={`Vista previa de ${template.title}`}>
      <header><span><Icon size={23} /></span><div><small>{template.eyebrow}</small><strong>{template.title}</strong></div></header>
      <p>{template.copy}</p>
      <div className="portal-template-metrics">
        {template.labels.map((label, index) => <div key={label}><span>{label}</span><strong>{index === 0 && view === "salary" ? "--,-- €" : "--"}</strong></div>)}
      </div>
      <div className="portal-template-lines"><i /><i /><i /></div>
      <small className="portal-template-note"><Lock size={14} /> Los datos aparecerán después de conectar el Portal CPE.</small>
    </section>
  );
}

function PortalResultPreview({ snapshot, session, view = "all", onSessionChange, onRequestSecurityKey, hideSyncFailure = false }) {
  const payload = snapshot?.payload || null;
  const primas = payload?.primas?.rows || [];
  const premiumHistory = Array.isArray(payload?.primas?.history) ? payload.primas.history : [];
  const currentPayrollMonthLabel = payload?.jornales?.monthLabel
    || (!payload?.primas?.locked && primas.length > 0 ? payload?.primas?.monthLabel : "");
  const portalJornales = selectPortalJornales(payload?.jornales, payload?.primas);
  const jornales = useMemo(() => mergeUpcomingAssignmentsIntoJornales(
    portalJornales,
    payload?.asignaciones?.rows,
    currentPayrollMonthLabel
  ), [currentPayrollMonthLabel, payload?.asignaciones?.rows, portalJornales]);
  const journalHistory = useMemo(() => {
    const savedHistory = selectPortalJornalesHistory(payload?.jornales, payload?.primas);
    if (Array.isArray(savedHistory) && savedHistory.length > 0) {
      const currentLabel = String(payload?.jornales?.monthLabel || currentPayrollMonthLabel).trim().toLocaleLowerCase("es");
      return savedHistory.map((period) => (
        String(period?.monthLabel || "").trim().toLocaleLowerCase("es") === currentLabel
          ? { ...period, rows: jornales }
          : period
      ));
    }
    if (!jornales.length) return [];

    return [{
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      monthLabel: payload?.jornales?.monthLabel || "Mes actual",
      rows: jornales
    }];
  }, [currentPayrollMonthLabel, jornales, payload?.jornales, payload?.primas]);
  const descansos = payload?.descansos || null;
  const hasDescansos = Array.isArray(descansos?.months) && descansos.months.length > 0;
  const slRows = payload?.sl?.rows || [];
  const vacaciones = payload?.vacaciones || null;
  const exceptions = payload?.excepciones || null;
  const nominas = payload?.nominas || null;
  const hasNominas = Boolean(nominas?.recognized && !nominas?.locked && (nominas?.rows || []).length > 0);
  const needsSecurityKey = Boolean(payload?.primas?.locked || payload?.nominas?.locked);
  const [selectedPeriod, setSelectedPeriod] = useState(() => (
    new Date().getDate() <= 15 ? "first" : "second"
  ));
  const [irpfRate, setIrpfRate] = useState(0);
  const [savedIrpfRate, setSavedIrpfRate] = useState(0);
  const [savingIrpf, setSavingIrpf] = useState(false);
  const [irpfMessage, setIrpfMessage] = useState("");
  const [irpfError, setIrpfError] = useState(false);
  const [jornalesExpanded, setJornalesExpanded] = useState(false);
  const [annualExpanded, setAnnualExpanded] = useState(false);
  const [nominasExpanded, setNominasExpanded] = useState(false);
  const [selectedJornal, setSelectedJornal] = useState(null);
  const [selectedAnnualMonthKey, setSelectedAnnualMonthKey] = useState("");
  const [selectedPayroll, setSelectedPayroll] = useState(null);
  const [payrollConfig, setPayrollConfig] = useState(null);
  const [relayHours, setRelayHours] = useState({});
  const [savingRelayHourKey, setSavingRelayHourKey] = useState("");
  const [relayHourError, setRelayHourError] = useState("");
  const [remateHours, setRemateHours] = useState({});
  const [savingRemateKey, setSavingRemateKey] = useState("");
  const [remateError, setRemateError] = useState("");
  const [manualPremiums, setManualPremiums] = useState({});
  const [savingPremiumKey, setSavingPremiumKey] = useState("");
  const [manualPremiumError, setManualPremiumError] = useState("");
  const jornalesRef = useRef(null);
  const descansosRef = useRef(null);
  const exceptionsRef = useRef(null);
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

  useEffect(() => {
    let active = true;
    setRelayHours({});
    setRelayHourError("");
    getUserRelayHours({ token: session.token })
      .then((hours) => {
        if (active) setRelayHours(hours || {});
      })
      .catch((error) => {
        if (active) setRelayHourError(error.message || "No se pudieron cargar las horas de relevo.");
      });
    return () => {
      active = false;
    };
  }, [session.token]);

  useEffect(() => {
    let active = true;
    setManualPremiums({});
    setManualPremiumError("");
    getUserManualPremiums({ token: session.token })
      .then((premiums) => {
        if (active) setManualPremiums(premiums || {});
      })
      .catch((error) => {
        if (active) setManualPremiumError(error.message || "No se pudieron cargar las primas manuales.");
      });
    return () => {
      active = false;
    };
  }, [session.token]);

  useEffect(() => {
    let active = true;
    setRemateHours({});
    setRemateError("");
    getUserRemateHours({ token: session.token })
      .then((hours) => {
        if (active) setRemateHours(hours || {});
      })
      .catch((error) => {
        if (active) setRemateError(error.message || "No se pudieron cargar los remates.");
      });
    return () => {
      active = false;
    };
  }, [session.token]);

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
  const vacationPayrollEntries = useMemo(() => buildVacationPayrollEntries(descansos), [descansos]);
  const enrichedJornales = useMemo(() => [
    ...enrichJornales(
      jornales,
      primas,
      currentPayrollMonthLabel,
      payrollConfig,
      relayHours,
      remateHours,
      manualPremiums
    ),
    ...vacationPayrollEntriesForMonth(vacationPayrollEntries, currentPayrollMonthLabel)
  ], [jornales, primas, currentPayrollMonthLabel, payrollConfig, relayHours, remateHours, manualPremiums, vacationPayrollEntries]);
  const payrollSummary = useMemo(() => summarizePayroll(enrichedJornales), [enrichedJornales]);
  const annualPayroll = useMemo(
    () => summarizeAnnualPayroll(
      journalHistory,
      payrollConfig,
      relayHours,
      vacationPayrollEntries,
      premiumHistory,
      remateHours,
      manualPremiums
    ),
    [journalHistory, payrollConfig, relayHours, vacationPayrollEntries, premiumHistory, remateHours, manualPremiums]
  );
  const selectedAnnualMonth = useMemo(() => annualPayroll.months.find((month) => (
    `${month.year}-${month.month}` === selectedAnnualMonthKey
  )) || null, [annualPayroll.months, selectedAnnualMonthKey]);
  const activeSelectedJornal = useMemo(() => {
    if (!selectedJornal) return null;
    const jornalKey = selectedJornal.payroll?.remateKey;
    return enrichedJornales.find((item) => item.payroll?.remateKey === jornalKey)
      || annualPayroll.months.flatMap((month) => month.enriched || []).find((item) => item.payroll?.remateKey === jornalKey)
      || selectedJornal;
  }, [selectedJornal, enrichedJornales, annualPayroll.months]);
  const selectedJornales = useMemo(
    () => filterJornalesByPeriod(enrichedJornales, selectedPeriod),
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
  const selectedCountLabel = [
    selectedSummary.workCount > 0 ? `${selectedSummary.workCount} ${selectedSummary.workCount === 1 ? "jornal" : "jornales"}` : "",
    selectedSummary.vacationDays > 0 ? `${selectedSummary.vacationDays} ${selectedSummary.vacationDays === 1 ? "día VA" : "días VA"}` : ""
  ].filter(Boolean).join(" + ");
  const annualCountLabel = [
    annualPayroll.count > 0 ? `${annualPayroll.count} jornales` : "",
    annualPayroll.vacationDays > 0 ? `${annualPayroll.vacationDays} VA` : ""
  ].filter(Boolean).join(" + ");

  const toggleRelayHour = async (item, enabled) => {
    const jornalKey = item.payroll?.relayHourKey;
    if (!jornalKey || !item.payroll?.relayHourEligible || savingRelayHourKey) return;

    const previous = Boolean(relayHours[jornalKey]);
    setRelayHourError("");
    setSavingRelayHourKey(jornalKey);
    setRelayHours((current) => ({ ...current, [jornalKey]: enabled }));
    try {
      await setUserRelayHour({ token: session.token, jornalKey, enabled });
    } catch (error) {
      setRelayHours((current) => ({ ...current, [jornalKey]: previous }));
      setRelayHourError(error.message || "No se pudo guardar la hora de relevo.");
    } finally {
      setSavingRelayHourKey("");
    }
  };

  const updateRemateHours = async (item, hours) => {
    const jornalKey = item.payroll?.remateKey;
    const normalizedHours = Number(hours);
    if (!jornalKey || !item.payroll?.remateEligible || ![0, 1, 2].includes(normalizedHours) || savingRemateKey) return;

    const previous = Number(remateHours[jornalKey] || 0);
    setRemateError("");
    setSavingRemateKey(jornalKey);
    setRemateHours((current) => {
      const next = { ...current };
      if (normalizedHours === 0) delete next[jornalKey];
      else next[jornalKey] = normalizedHours;
      return next;
    });
    try {
      await setUserRemateHours({ token: session.token, jornalKey, hours: normalizedHours });
    } catch (error) {
      setRemateHours((current) => {
        const next = { ...current };
        if (previous === 0) delete next[jornalKey];
        else next[jornalKey] = previous;
        return next;
      });
      setRemateError(error.message || "No se pudo guardar el remate.");
    } finally {
      setSavingRemateKey("");
    }
  };

  const updateManualPremium = async (item, amount) => {
    const jornalKey = item.payroll?.manualPremiumKey;
    const normalizedAmount = Number(amount);
    if (!jornalKey || !item.payroll?.manualPremiumEligible || !Number.isFinite(normalizedAmount) || normalizedAmount < 0 || normalizedAmount > 99999.99 || savingPremiumKey) return;
    if (item.payroll?.portalPrima != null && Number(normalizedAmount.toFixed(2)) === Number(Number(item.payroll.portalPrima).toFixed(2))) {
      await usePortalPremium(item);
      return;
    }

    const previous = manualPremiums[jornalKey];
    const nextRecord = {
      amount: Number(normalizedAmount.toFixed(2)),
      portalAmountAtEdit: item.payroll?.portalPrima == null ? null : Number(item.payroll.portalPrima)
    };
    setManualPremiumError("");
    setSavingPremiumKey(jornalKey);
    setManualPremiums((current) => ({ ...current, [jornalKey]: nextRecord }));
    try {
      await setUserManualPremium({
        token: session.token,
        jornalKey,
        amount: nextRecord.amount,
        portalAmount: nextRecord.portalAmountAtEdit
      });
    } catch (error) {
      setManualPremiums((current) => {
        const next = { ...current };
        if (previous == null) delete next[jornalKey];
        else next[jornalKey] = previous;
        return next;
      });
      setManualPremiumError(error.message || "No se pudo guardar la prima manual.");
    } finally {
      setSavingPremiumKey("");
    }
  };

  const usePortalPremium = async (item) => {
    const jornalKey = item.payroll?.manualPremiumKey;
    if (!jornalKey || savingPremiumKey) return;

    const previous = manualPremiums[jornalKey];
    setManualPremiumError("");
    setSavingPremiumKey(jornalKey);
    setManualPremiums((current) => {
      const next = { ...current };
      delete next[jornalKey];
      return next;
    });
    try {
      await setUserManualPremium({ token: session.token, jornalKey, amount: null, portalAmount: null });
    } catch (error) {
      setManualPremiums((current) => {
        const next = { ...current };
        if (previous == null) delete next[jornalKey];
        else next[jornalKey] = previous;
        return next;
      });
      setManualPremiumError(error.message || "No se pudo recuperar la prima del portal.");
    } finally {
      setSavingPremiumKey("");
    }
  };

  if (!payload) {
    return <PortalFeatureTemplate view={view} />;
  }

  return (
    <div className="portal-results">
      <section className="portal-sync-card">
        <span>Ultima sincronizacion</span>
        <strong>{formatUpdatedAt(snapshot.updatedAt)}</strong>
        <small>Chapa {snapshot.chapa}</small>
      </section>

      {payload?.sync?.inProgress && (
        <section className="portal-sync-progress" role="status">
          <RefreshCw size={20} />
          <div>
            <strong>{payload.sync.stage || "Actualizando el portal"}</strong>
            <span>Puedes consultar lo que ya esta disponible mientras seguimos cargando el resto.</span>
          </div>
        </section>
      )}

      {payload?.sync?.partial && !payload?.sync?.inProgress && !payload?.sync?.failed && needsSecurityKey && (
        <button className="portal-sync-warning portal-security-prompt" type="button" onClick={onRequestSecurityKey}>
          <CircleAlert size={20} />
          <div><strong>Introduce tu clave de seguridad para cargar primas y nóminas</strong></div>
          <ChevronRight size={19} />
        </button>
      )}

      {view === "all" && (enrichedJornales.length > 0 || hasDescansos || exceptions?.recognized || vacaciones?.recognized || hasNominas) && (
        <nav className="portal-section-shortcuts" aria-label="Accesos a los datos del portal">
          {enrichedJornales.length > 0 && (
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
          {hasDescansos && (
            <button className="is-descansos" type="button" onClick={() => descansosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <CalendarDays size={19} /><span>Descansos</span><ChevronDown size={17} />
            </button>
          )}
          {exceptions?.recognized && (
            <button className="is-excepciones" type="button" onClick={() => exceptionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <CalendarOff size={19} /><span>Excepciones</span><ChevronDown size={17} />
            </button>
          )}
          {vacaciones?.recognized && (
            <button className="is-vacaciones" type="button" onClick={() => vacacionesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <Sun size={19} /><span>Vacaciones</span><ChevronDown size={17} />
            </button>
          )}
          {hasNominas && (
            <button className="is-nominas" type="button" onClick={() => {
              setNominasExpanded(true);
              requestAnimationFrame(() => nominasRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
            }}>
              <FileLock2 size={19} /><span>Nóminas</span><ChevronDown size={17} />
            </button>
          )}
        </nav>
      )}

      {(view === "all" || view === "salary") && enrichedJornales.length > 0 && (
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
                <small>{selectedCountLabel || "Sin conceptos"} · IRPF {irpfRate}%</small>
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
                  <strong>{annualCountLabel || "Sin conceptos"}</strong>
                  <small>{formatEuro(annualPayroll.total)} bruto</small>
                </span>
                <ChevronDown size={19} />
              </button>
              {annualExpanded && (
                <div className="portal-annual-content">
                  <div className="portal-annual-kpis">
                    <div><span>Número de jornales</span><strong>{annualPayroll.count}</strong></div>
                    {annualPayroll.vacationDays > 0 && <div><span>Días de vacaciones</span><strong>{annualPayroll.vacationDays}</strong></div>}
                    <div><span>Bruto anual</span><strong>{formatEuro(annualPayroll.total)}</strong></div>
                    <div><span>Media mensual</span><strong>{formatEuro(annualPayroll.activeMonths ? annualPayroll.total / annualPayroll.activeMonths : 0)}</strong></div>
                    <div><span>Neto anual</span><strong>{formatEuro(annualPayroll.total * (1 - irpfRate / 100))}</strong></div>
                  </div>
                  <div className="portal-annual-chart" aria-label="Jornales por mes">
                    {annualPayroll.months.map((month) => {
                      const maxCount = Math.max(1, ...annualPayroll.months.map((item) => item.count));
                      return (
                        <button
                          key={`${month.year}-${month.month}`}
                          type="button"
                          title={`Abrir ${month.monthLabel}: ${month.count} jornales`}
                          aria-label={`Abrir detalle de ${month.monthLabel}, ${month.count} jornales`}
                          onClick={() => setSelectedAnnualMonthKey(`${month.year}-${month.month}`)}
                        >
                          <span>{month.count || ""}</span>
                          <i style={{ height: `${Math.max(month.count ? 12 : 2, (month.count / maxCount) * 72)}px` }} />
                          <small>{MONTH_SHORT_ES[(month.month || 1) - 1]}</small>
                        </button>
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
            <small>{selectedCountLabel || "Sin conceptos"} <ChevronDown size={17} /></small>
          </button>
          {jornalesExpanded && <div className="portal-jornales-list">
            {relayHourError && <p className="portal-relay-hour-error"><CircleAlert size={15} /> {relayHourError}</p>}
            {visibleJornales.length === 0 && (
              <div className="portal-empty-state compact">
                <BriefcaseBusiness size={22} />
                <strong>{selectedPeriod === "month" ? "Sin jornales este mes" : "Sin jornales en esta quincena"}</strong>
              </div>
            )}
            {visibleJornales.map((item, index) => {
              const logo = companyLogo(item.empresa);
              if (item.isVacation) {
                return (
                  <article key={`${item.jornal}-${index}`} className="is-vacation">
                    <div className="portal-jornal-date">
                      <strong>{item.dia || "-"}</strong>
                      <span>VA</span>
                    </div>
                    <div className="portal-jornal-content">
                      <div className="portal-jornal-heading">
                        <strong>Vacaciones</strong>
                        <strong className="portal-jornal-total">{formatEuro(item.payroll?.total)}</strong>
                      </div>
                      <em>Día de vacaciones retribuido</em>
                      <div className="portal-jornal-breakdown">
                        <span className="is-vacation-amount">Importe <b>{formatEuro(item.payroll?.total)}</b></span>
                      </div>
                    </div>
                  </article>
                );
              }
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
                      {item.payroll?.continuousDoubleMeal > 0 && (
                        <span>Manutención doble · {item.payroll.continuousDoubleMealHours} <b>{formatEuro(item.payroll.continuousDoubleMeal)}</b></span>
                      )}
                      {item.payroll?.remate > 0 && (
                        <span>Remate · {item.payroll.remateHours} {item.payroll.remateHours === 1 ? "hora" : "horas"} <b>{formatEuro(item.payroll.remate)}</b></span>
                      )}
                      {item.payroll?.operationType !== "RECEPCION_ENTREGA" && (
                        <span className={item.payroll?.prima > 0
                          ? `is-prima${item.payroll?.primaVerification === "pending" ? " is-unverified" : ""}`
                          : "is-pending"}>
                          Prima <b>{item.payroll?.prima > 0 ? formatEuro(item.payroll.prima) : "Pendiente"}</b>
                        </span>
                      )}
                    </div>
                    {item.payroll?.relayHourEligible && (
                      <label
                        className={`portal-relay-hour${item.payroll.relayHourEnabled ? " is-enabled" : ""}`}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={item.payroll.relayHourEnabled}
                          disabled={Boolean(savingRelayHourKey)}
                          onChange={(event) => toggleRelayHour(item, event.target.checked)}
                        />
                        <span>
                          Hora de relevo
                          <small>{item.payroll.relayHourRateKey === "FESTIVO" ? "Festiva" : "Laborable"} · +{formatEuro(item.payroll.relayHourRate)}</small>
                        </span>
                      </label>
                    )}
                  </div>
                  <ChevronRight className="portal-jornal-chevron" size={19} />
                </article>
              );
            })}
          </div>}
        </section>
      )}

      {(view === "all" || view === "rests") && descansos && (
        <div ref={descansosRef} className="portal-scroll-anchor">
          <PortalCalendarPreview descansos={descansos} slRows={slRows} />
        </div>
      )}

      {(view === "all" || view === "holidays") && (
        <div ref={vacacionesRef} className="portal-scroll-anchor">
          <PortalVacationPreview vacaciones={vacaciones} />
        </div>
      )}

      {(view === "all" || view === "exceptions") && exceptions?.recognized && (
        <div ref={exceptionsRef} className="portal-scroll-anchor">
          <PortalExceptionsPreview exceptions={exceptions} />
        </div>
      )}

      {(view === "all" ? hasNominas : view === "payrolls" && nominas?.recognized) && (
        <section ref={nominasRef} className={`portal-personal-section portal-payroll-documents portal-scroll-anchor${nominasExpanded ? " is-open" : ""}`}>
          <button className="portal-payroll-toggle" type="button" onClick={() => setNominasExpanded((current) => !current)} aria-expanded={nominasExpanded}>
            <span className="portal-personal-icon is-payroll"><FileLock2 size={21} /></span>
            <span><small>Modo seguro</small><strong>Nómina electrónica</strong></span>
            {!nominas.locked && <b>{nominas.rows?.length || 0}</b>}
            <ChevronDown size={19} />
          </button>
          {nominasExpanded && (nominas.locked ? (
            <p className="portal-secure-empty"><Lock size={18} /><span><strong>Clave de seguridad necesaria</strong><small>Configúrala en Mi portal y actualiza para consultar tus nóminas.</small></span></p>
          ) : (nominas.rows || []).length ? (
            <div className="portal-payroll-document-list">
              {nominas.rows.map((payroll) => (
                <button key={payroll.id} type="button" onClick={() => setSelectedPayroll(payroll)}>
                  <ReceiptText size={18} />
                  <span><strong>{payroll.type}</strong><small>Periodo {payroll.period}</small></span>
                  <em>{payroll.period}</em>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
          ) : <p className="portal-personal-empty">No hay nóminas disponibles.</p>)}
        </section>
      )}

      {selectedAnnualMonth && (
        <PortalMonthDetailModal
          month={selectedAnnualMonth}
          irpfRate={irpfRate}
          onClose={() => setSelectedAnnualMonthKey("")}
          onToggleRelayHour={toggleRelayHour}
          onOpenJornal={(item) => {
            setSelectedAnnualMonthKey("");
            setSelectedJornal(item);
          }}
          savingRelayHourKey={savingRelayHourKey}
          relayHourError={relayHourError}
        />
      )}
      {activeSelectedJornal && (
        <PortalJornalDetailModal
          jornal={activeSelectedJornal}
          onClose={() => setSelectedJornal(null)}
          onSetRemateHours={updateRemateHours}
          savingRemateKey={savingRemateKey}
          remateError={remateError}
          onSetManualPremium={updateManualPremium}
          onUsePortalPremium={usePortalPremium}
          savingPremiumKey={savingPremiumKey}
          premiumError={manualPremiumError}
        />
      )}
      {selectedPayroll && (
        <PayrollDocumentErrorBoundary onClose={() => setSelectedPayroll(null)}>
          <PayrollDocumentModal payroll={selectedPayroll} session={session} onClose={() => setSelectedPayroll(null)} />
        </PayrollDocumentErrorBoundary>
      )}
      {view === "salary" && enrichedJornales.length === 0 && <PortalFeatureTemplate view="salary" />}
      {view === "rests" && !descansos && <PortalFeatureTemplate view="rests" />}
      {view === "exceptions" && !exceptions?.recognized && <PortalFeatureTemplate view="exceptions" />}
      {view === "holidays" && !vacaciones?.recognized && <PortalFeatureTemplate view="holidays" />}
      {view === "payrolls" && !nominas?.recognized && <PortalFeatureTemplate view="payrolls" />}
    </div>
  );
}

function PortalPanel({
  session,
  view = "all",
  initialSnapshot = null,
  onSnapshotChange,
  onSessionChange,
  onConnectionChange,
  openCredentialsOnLoad = false,
  onCredentialsRequestChange
}) {
  const credentialsOnly = view === "all";
  const initialCredentials = useMemo(() => readPortalCredentials(session.chapa), [session.chapa]);
  const pendingActivation = session.portalActivationStatus === "pending";
  const initialActiveSync = useMemo(
    () => pendingActivation ? null : readPortalActiveSync(session.chapa),
    [pendingActivation, session.chapa]
  );
  const [loading, setLoading] = useState(!initialSnapshot && !pendingActivation);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [portalPassword, setPortalPassword] = useState(initialCredentials?.portalPassword || "");
  const [securityKey, setSecurityKey] = useState(initialCredentials?.securityKey || "");
  const [activationEmail, setActivationEmail] = useState(session.email || "");
  const [savedCredentials, setSavedCredentials] = useState(initialCredentials);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(Boolean(initialCredentials));
  const [portalSyncStatus, setPortalSyncStatus] = useState("active");
  const [reactivatingPortal, setReactivatingPortal] = useState(false);
  const [syncingPortal, setSyncingPortal] = useState(Boolean(initialActiveSync));
  const [portalJob, setPortalJob] = useState(initialActiveSync || null);
  const [portalMessage, setPortalMessage] = useState(initialActiveSync ? "Recuperando la sincronizacion en curso..." : "");
  const [showCredentials, setShowCredentials] = useState(credentialsOnly || Boolean(openCredentialsOnLoad));
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [securityKeyOnly, setSecurityKeyOnly] = useState(false);
  const [syncProgress, setSyncProgress] = useState(initialActiveSync ? 3 : 0);
  const [syncElapsed, setSyncElapsed] = useState(initialActiveSync ? Math.floor((Date.now() - initialActiveSync.startedAt) / 1000) : 0);
  const syncStartedAtRef = useRef(initialActiveSync?.startedAt || 0);
  const syncEstimateRef = useRef(getPortalSyncEstimate(session.chapa));
  const lastProgressRefreshRef = useRef(0);
  const portalErrorRef = useRef(null);
  const credentialsRef = useRef(null);

  const loadSnapshot = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setError("");
      setLoading(true);
    }
    if (pendingActivation) {
      setSnapshot(null);
      onSnapshotChange?.(null);
      if (credentialsOnly || !autoSyncEnabled) setShowCredentials(true);
      setLoading(false);
      return;
    }
    try {
      const data = await getOfficialPortalSnapshot({ token: session.token });
      setSnapshot(data || null);
      onSnapshotChange?.(data || null);
      const rejectedCredentials = hasRejectedPortalCredentials(data);
      setShowCredentials(credentialsOnly || !data?.payload || rejectedCredentials);
      if (rejectedCredentials) {
        setError("");
        setAutoSyncEnabled(false);
        onConnectionChange?.(false);
        const refreshedSession = await refreshCurrentUser({ token: session.token }).catch(() => null);
        if (refreshedSession) onSessionChange?.(refreshedSession);
      }
    } catch (requestError) {
      // Los fallos de lectura se supervisan en Supabase; no se muestran al usuario.
    } finally {
      if (!silent) setLoading(false);
    }
  }, [autoSyncEnabled, credentialsOnly, onConnectionChange, onSessionChange, onSnapshotChange, pendingActivation, session.token]);

  useEffect(() => {
    loadSnapshot({ silent: Boolean(initialSnapshot) });
  }, [pendingActivation, session.token]);

  useEffect(() => {
    if (pendingActivation || syncingPortal) return undefined;

    let refreshing = false;
    const refreshSnapshot = async () => {
      if (document.visibilityState !== "visible" || refreshing) return;
      refreshing = true;
      try {
        await loadSnapshot({ silent: true });
      } finally {
        refreshing = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshSnapshot();
    };
    const timer = window.setInterval(refreshSnapshot, SNAPSHOT_POLL_MS);
    window.addEventListener("focus", refreshSnapshot);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshSnapshot);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadSnapshot, pendingActivation, syncingPortal]);

  useEffect(() => {
    if (!openCredentialsOnLoad || loading || syncingPortal) return;
    setError("");
    setSecurityKeyOnly(false);
    setShowCredentials(true);
    onCredentialsRequestChange?.(false);
    window.requestAnimationFrame(() => {
      credentialsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [loading, onCredentialsRequestChange, openCredentialsOnLoad, syncingPortal]);

  useEffect(() => {
    let cancelled = false;
    const activity = session.supportAccess
      ? Promise.resolve(null)
      : touchPortalActivity({ token: session.token }).catch(() => null);
    activity
      .then(() => getPortalAutoSyncStatus({ token: session.token }))
      .then(async (status) => {
        if (cancelled) return;
        setPortalSyncStatus(status?.syncStatus || "active");
        if (status?.enabled) {
          setAutoSyncEnabled(true);
          if (session.portalActivationStatus === "pending" && !initialSnapshot) setShowCredentials(credentialsOnly);
          onConnectionChange?.(true);
          return;
        }

        if (initialCredentials?.portalPassword) {
          await setPortalAutoSync({
            token: session.token,
            enabled: true,
            portalPassword: initialCredentials.portalPassword,
            securityKey: initialCredentials.securityKey || ""
          });
          if (!cancelled) {
            setAutoSyncEnabled(true);
            onConnectionChange?.(true);
          }
          return;
        }

        setAutoSyncEnabled(false);
        onConnectionChange?.(false);
      })
      .catch((statusError) => {
        if (!cancelled) console.warn("No se pudo leer la sincronizacion automatica:", statusError.message);
      });
    return () => { cancelled = true; };
  }, [credentialsOnly, initialCredentials, onConnectionChange, session.supportAccess, session.token]);

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
        if (stopped) return;
        if (!job) {
          const status = await getPortalAutoSyncStatus({ token: session.token });
          if (status?.enabled === false) {
            setSyncingPortal(false);
            setAutoSyncEnabled(false);
            onConnectionChange?.(false);
            writePortalActiveSync(session.chapa, null);
            window.clearInterval(timer);
            await loadSnapshot();
          }
          return;
        }
        setPortalJob(job);
        writePortalActiveSync(session.chapa, {
          jobId: portalJob.jobId,
          status: job.status,
          startedAt: syncStartedAtRef.current
        });
        if (["queued", "running"].includes(job.status) && Date.now() - lastProgressRefreshRef.current >= 4000) {
          lastProgressRefreshRef.current = Date.now();
          await loadSnapshot({ silent: true });
        }
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
          setShowCredentials(credentialsOnly);
          setSyncingPortal(false);
          writePortalActiveSync(session.chapa, null);
        }
        if (job.status === "failed") {
          const rejectedCredentials = hasRejectedPortalCredentials(job.message);
          setPortalMessage("");
          setSyncingPortal(false);
          setShowCredentials(credentialsOnly || rejectedCredentials);
          if (rejectedCredentials) {
            setError("");
            setAutoSyncEnabled(false);
            onConnectionChange?.(false);
          }
          writePortalActiveSync(session.chapa, null);
          window.clearInterval(timer);
          await loadSnapshot();
        }
      } catch (requestError) {
        if (!stopped) setPortalMessage("");
      }
    }, 1500);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [credentialsOnly, portalJob?.jobId, portalJob?.status, session.token]);

  const saveCredentials = async () => {
    const passwordToUse = portalPassword.trim() || savedCredentials?.portalPassword || "";
    const securityKeyToUse = securityKey.trim() || savedCredentials?.securityKey || "";
    if (!passwordToUse && !autoSyncEnabled) {
      setError("Introduce la contraseña del portal.");
      setShowCredentials(true);
      window.requestAnimationFrame(() => {
        portalErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    setError("");
    setPortalMessage("Cargando datos...");
    setSavingCredentials(true);

    try {
      let queuedAnnualHistory = false;
      let currentSession = session;
      const requiresActivationRequest = !securityKeyOnly && !autoSyncEnabled;
      if (requiresActivationRequest || !session.email) {
        const normalizedEmail = activationEmail.trim();
        if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
          throw new Error("Introduce un correo electrónico válido.");
        }
        const updatedSession = await updateActivationEmail({ token: session.token, email: normalizedEmail });
        if (updatedSession) {
          currentSession = updatedSession;
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSession));
          } catch {
            // La sesión sigue activa aunque el navegador impida persistirla.
          }
          onSessionChange?.(updatedSession);
        }
      }
      if (securityKeyOnly && securityKeyToUse) {
        const securityResult = await setPortalSecurityKey({ token: session.token, securityKey: securityKeyToUse });
        queuedAnnualHistory = securityResult?.requestKind === "history";
        setPortalSyncStatus("active");
      } else if (passwordToUse) {
        await setPortalAutoSync({
          token: session.token,
          enabled: true,
          portalPassword: passwordToUse,
          securityKey: securityKeyToUse
        });
        setAutoSyncEnabled(true);
        onConnectionChange?.(true);
      }
      writePortalCredentials(session.chapa, null);
      setSavedCredentials(null);
      setPortalPassword("");
      setSecurityKey("");
      setSecurityKeyOnly(false);
      setShowCredentials(credentialsOnly);
      if (requiresActivationRequest || (currentSession.portalActivationStatus === "pending" && !snapshot?.payload)) {
        await queuePendingPortalActivation({ token: session.token });
        setPortalMessage("Solicitud enviada. Te avisaremos por correo cuando tu acceso esté activado.");
        await sendPendingActivationEmails();
      } else {
        setPortalMessage(queuedAnnualHistory
          ? "En la próxima sincronización se cargarán tus primas y nóminas de todo el año."
          : "Datos de acceso configurados correctamente.");
      }
    } catch (requestError) {
      setPortalMessage("");
      setError(requestError.message || "No se pudieron configurar los datos de acceso al portal.");
    } finally {
      setSavingCredentials(false);
    }
  };

  const requestSecurityKey = () => {
    setError("");
    setPortalPassword("");
    setSecurityKey("");
    setSecurityKeyOnly(autoSyncEnabled);
    setShowCredentials(true);
    window.requestAnimationFrame(() => {
      credentialsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const reactivatePausedPortal = async () => {
    setReactivatingPortal(true);
    setError("");
    try {
      const result = await reactivatePortalSync({ token: session.token });
      setPortalSyncStatus("active");
      setPortalMessage(result?.requestKind === "history"
        ? "Cuenta reactivada. La recuperación completa está en cola para la próxima ejecución."
        : "Cuenta reactivada. La actualización del mes actual está en cola para la próxima ejecución.");
    } catch (reactivationError) {
      setError(reactivationError?.message || "No se pudo reactivar la actualización del portal.");
    } finally {
      setReactivatingPortal(false);
    }
  };

  const syncRemaining = Math.max(0, Math.ceil(syncEstimateRef.current - syncElapsed));
  const panelCopy = {
    all: { eyebrow: "Ajustes", title: "Acceso al portal" },
    salary: { eyebrow: "Jornales y salario", title: "Sueldómetro" },
    rests: { eyebrow: "Calendario personal", title: "Descansos" },
    exceptions: { eyebrow: "Bolsa anual", title: "Excepciones" },
    holidays: { eyebrow: "Planificación", title: "Vacaciones" },
    payrolls: { eyebrow: "Documentos personales", title: "Nóminas" }
  }[view] || { eyebrow: "Portal oficial", title: "Mi portal" };

  return (
    <section className="page-panel portal-panel">
      <div className="section-heading">
        <p>{panelCopy.eyebrow}</p>
        <h1>{panelCopy.title}</h1>
      </div>

      {!credentialsOnly && session.portalActivationStatus === "pending" && autoSyncEnabled && !snapshot?.payload && !showCredentials && (
        <section className="portal-empty-state portal-activation-pending" aria-live="polite">
          <Clock3 size={28} />
          <strong>Cuenta pendiente de activación</strong>
          <span>Te enviaremos un correo a {session.email || "tu dirección de registro"} cuando tu cuenta esté activada.</span>
        </section>
      )}

      {!credentialsOnly && portalSyncStatus === "paused_inactive" && !showCredentials && (
        <section className="portal-inactivity-pause" aria-live="polite">
          <Clock3 size={25} />
          <div>
            <strong>Actualizaciones en pausa por inactividad</strong>
            <span>Tus datos siguen guardados. Reactiva la cuenta para volver a incluirla en las próximas sincronizaciones.</span>
          </div>
          <button type="button" onClick={reactivatePausedPortal} disabled={reactivatingPortal}>
            {reactivatingPortal ? "Reactivando…" : "Reactivar actualizaciones"}
          </button>
        </section>
      )}

      {error && <p ref={portalErrorRef} className="portal-warning">{error}</p>}

      {showCredentials && (
        <>
          {!credentialsOnly && <p className="portal-first-sync-note">
            Introduce tus datos de acceso para conectar tu cuenta con el Portal CPE.
          </p>}

          <section ref={credentialsRef} className="portal-security-card">
            <div>
              <p>{securityKeyOnly ? "Añadir clave de seguridad" : snapshot?.payload ? "Cambiar acceso al portal" : "Conectar con el portal"}</p>
              <span>{securityKeyOnly
                ? "Introduce la clave de seguridad de primas y nóminas."
                : "Introduce tu contraseña del portal de SEVASA. La clave de seguridad es opcional y solo se usa para consultar primas y nóminas."}</span>
            </div>
            {!securityKeyOnly && (!autoSyncEnabled || !session.email) && (
              <label>
                <Mail size={17} />
                <input
                  aria-label="Correo electrónico para la activación"
                  autoComplete="email"
                  placeholder="Correo electrónico para avisarte del alta"
                  type="email"
                  value={activationEmail}
                  onChange={(event) => setActivationEmail(event.target.value)}
                />
              </label>
            )}
            {!securityKeyOnly && (
              <label>
                <Lock size={17} />
                <input
                  autoComplete="current-password"
                  placeholder="Contraseña del portal de SEVASA"
                  type="password"
                  value={portalPassword}
                  onChange={(event) => setPortalPassword(event.target.value)}
                />
              </label>
            )}
            <label>
              <Lock size={17} />
              <input
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                inputMode="text"
                spellCheck={false}
                aria-label="Clave de seguridad opcional"
                placeholder="Clave de seguridad (opcional)"
                type="password"
                value={securityKey}
                onChange={(event) => setSecurityKey(event.target.value)}
              />
            </label>
            <div className="portal-security-actions">
              {!credentialsOnly && snapshot?.payload && !syncingPortal && (
                <button className="secondary-button" type="button" onClick={() => setShowCredentials(false)}>
                  Cancelar
                </button>
              )}
              <button
                className="primary-button"
                type="button"
                disabled={syncingPortal || savingCredentials || ((!autoSyncEnabled || !session.email) && !securityKeyOnly && !activationEmail.trim()) || (securityKeyOnly ? !securityKey.trim() : !portalPassword.trim())}
                onClick={saveCredentials}
              >
                {syncingPortal ? "Sincronización en curso" : savingCredentials ? "Cargando datos..." : securityKeyOnly ? "Actualizar datos" : "Cargar datos"}
              </button>
            </div>
            {portalMessage && <small>{portalMessage}</small>}
          </section>
        </>
      )}

      {!credentialsOnly && syncingPortal && (
        <section className="portal-progress-card" aria-live="polite">
          <div className="portal-progress-heading">
            <span><RefreshCw size={18} className="is-spinning" />Actualizando portal</span>
            <strong>{Math.round(syncProgress)}%</strong>
          </div>
          <div className="portal-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(syncProgress)}>
            <span style={{ width: `${syncProgress}%` }} />
          </div>
          <div className="portal-progress-meta">
            <span>{portalJob?.status === "running" ? "Leyendo datos del portal" : "Preparando la lectura segura"}</span>
            <small>{syncRemaining > 0 ? `Aproximadamente ${syncRemaining} s restantes` : "Finalizando..."} · {syncElapsed} s transcurridos</small>
          </div>
        </section>
      )}

      {!credentialsOnly && (syncingPortal && !snapshot?.payload ? (
        <div className="portal-empty-state">
          <RefreshCw className="is-spinning" size={26} />
          <strong>Conectado con el portal</strong>
          <span>Los primeros datos aparecerán aquí en unos segundos mientras continúa la lectura.</span>
        </div>
      ) : loading && !snapshot?.payload ? (
        <div className="portal-empty-state">
          <Clock3 size={26} />
          <strong>Cargando portal</strong>
          <span>Buscando el ultimo sincronizado de tu chapa.</span>
        </div>
      ) : (
        <PortalResultPreview
          snapshot={snapshot}
          session={session}
          view={view}
          onSessionChange={onSessionChange}
          onRequestSecurityKey={() => requestSecurityKey()}
          hideSyncFailure={showCredentials}
        />
      ))}
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

const FORUM_PAGE_SIZE = 50;

function normalizeForumMessage(row) {
  return {
    id: Number(row?.id),
    authorChapa: normalizeChapa(row?.author_chapa || row?.authorChapa),
    authorName: String(row?.author_name || row?.authorName || "Usuario"),
    authorShowChapa: Boolean(row?.author_show_chapa ?? row?.authorShowChapa),
    message: String(row?.message || ""),
    createdAt: row?.created_at || row?.createdAt || new Date().toISOString()
  };
}

function formatForumDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function ForumPanel({ session, onLatestMessage }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState("");
  const messagesRef = useRef([]);
  const messageListRef = useRef(null);
  const initialScrollRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const mergeMessages = useCallback((rows) => {
    const normalizedRows = rows
      .map(normalizeForumMessage)
      .filter((message) => Number.isFinite(message.id) && message.message)
      .sort((a, b) => a.id - b.id);

    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      normalizedRows.forEach((message) => byId.set(message.id, message));
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });

    const latestId = normalizedRows.reduce((latest, message) => Math.max(latest, message.id), 0);
    if (latestId) onLatestMessage?.(latestId);
    return normalizedRows;
  }, [onLatestMessage]);

  const loadLatest = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const rows = await getForumMessages({ token: session.token, limit: FORUM_PAGE_SIZE });
      mergeMessages(rows);
      setHasOlder(rows.length === FORUM_PAGE_SIZE);
      setError("");
    } catch (loadError) {
      if (!silent) setError(loadError.message || "No se pudo cargar el foro.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [mergeMessages, session.token]);

  useEffect(() => {
    loadLatest();
    const refresh = () => loadLatest({ silent: true });
    const timer = window.setInterval(refresh, 20_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [loadLatest]);

  useEffect(() => {
    if (loading || initialScrollRef.current || !messages.length) return;
    initialScrollRef.current = true;
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [loading, messages.length]);

  const loadOlder = async () => {
    const firstId = messagesRef.current[0]?.id;
    if (!firstId || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const rows = await getForumMessages({
        token: session.token,
        limit: FORUM_PAGE_SIZE,
        beforeId: firstId
      });
      mergeMessages(rows);
      setHasOlder(rows.length === FORUM_PAGE_SIZE);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "No se pudieron cargar mensajes anteriores.");
    } finally {
      setLoadingOlder(false);
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;

    setSending(true);
    setError("");
    try {
      const saved = await postForumMessage({ token: session.token, message });
      if (saved) mergeMessages([saved]);
      setDraft("");
      window.setTimeout(() => {
        const list = messageListRef.current;
        list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
      }, 0);
    } catch (sendError) {
      setError(sendError.message || "No se pudo enviar el mensaje.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="forum-page">
      <header className="forum-hero">
        <span><MessageCircle size={26} /></span>
        <div>
          <p>Comunidad Estibadores - Puerto de Valencia</p>
          <h1>Foro</h1>
          <small>Comparte avisos, dudas y comentarios con tus compañeros.</small>
        </div>
      </header>

      <section className="forum-card">
        <header className="forum-card-heading">
          <div>
            <strong>Conversación general</strong>
            <span>{messages.length ? `${messages.length} mensajes cargados` : "Empieza la conversación"}</span>
          </div>
          <span className="forum-live"><i /> En línea</span>
        </header>

        <div ref={messageListRef} className="forum-messages" aria-live="polite" aria-busy={loading}>
          {hasOlder && (
            <button className="forum-load-older" type="button" disabled={loadingOlder} onClick={loadOlder}>
              {loadingOlder ? <LoaderCircle className="is-spinning" size={15} /> : <Clock3 size={15} />}
              {loadingOlder ? "Cargando..." : "Ver mensajes anteriores"}
            </button>
          )}

          {loading && !messages.length ? (
            <div className="forum-empty">
              <LoaderCircle className="is-spinning" size={26} />
              <strong>Cargando conversación</strong>
            </div>
          ) : !messages.length ? (
            <div className="forum-empty">
              <MessageCircle size={28} />
              <strong>Todavía no hay mensajes</strong>
              <span>Sé el primero en escribir.</span>
            </div>
          ) : messages.map((message) => {
            const isOwn = message.authorChapa === normalizeChapa(session.chapa);
            const isAdminMessage = message.authorChapa === "72683";
            return (
              <article key={message.id} className={`forum-message${isOwn ? " is-own" : ""}${isAdminMessage ? " is-admin" : ""}`}>
                <div className="forum-avatar" aria-hidden="true">
                  {isAdminMessage ? "A" : message.authorName.charAt(0).toUpperCase()}
                </div>
                <div className="forum-message-content">
                  <header>
                    <strong>{isAdminMessage ? "Administrador" : message.authorName}</strong>
                    {isAdminMessage && <span>ADMIN</span>}
                    {!isAdminMessage && message.authorShowChapa && <span className="forum-chapa-badge">Chapa {message.authorChapa}</span>}
                    <time dateTime={message.createdAt}>{formatForumDate(message.createdAt)}</time>
                  </header>
                  <p>{message.message}</p>
                </div>
              </article>
            );
          })}
        </div>

        <form className="forum-composer" onSubmit={sendMessage}>
          <label htmlFor="forum-message">Escribe un mensaje</label>
          <div>
            <textarea
              id="forum-message"
              maxLength={500}
              rows={3}
              placeholder="Comparte algo con tus compañeros..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" disabled={sending || !draft.trim()} aria-label="Enviar mensaje">
              {sending ? <LoaderCircle className="is-spinning" size={20} /> : <Send size={20} />}
              <span>{sending ? "Enviando" : "Enviar"}</span>
            </button>
          </div>
          <footer>
            <span>{error || "Respeta a los demás participantes."}</span>
            <strong>{draft.length}/500</strong>
          </footer>
        </form>
      </section>
    </section>
  );
}

const NOTIFICATION_TYPES = {
  new_journal: { label: "Jornal", Icon: CalendarCheck2, tone: "journal" },
  new_premium: { label: "Prima", Icon: WalletCards, tone: "premium" },
  premium_modified: { label: "Prima", Icon: ReceiptText, tone: "premium-change" },
  new_payroll: { label: "Nómina", Icon: FileLock2, tone: "payroll" },
  rests_changed: { label: "Descansos", Icon: CalendarDays, tone: "rests" },
  vacations_changed: { label: "Vacaciones", Icon: Sun, tone: "holidays" },
  exceptions_changed: { label: "Excepciones", Icon: CalendarOff, tone: "exceptions" }
};

function notificationGroupLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Anteriores";
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((start - target) / 86400000);
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long" }).format(date);
}

function notificationTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Ahora";
  if (seconds < 3600) return `Hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `Hace ${Math.floor(seconds / 3600)} h`;
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function NotificationsPanel({ notifications, loading, error, onOpen, onMarkAll }) {
  const [filter, setFilter] = useState("all");
  const rows = notifications?.rows || [];
  const filtered = rows.filter((item) => {
    if (filter === "unread") return !item.readAt;
    if (filter === "journals") return item.eventType === "new_journal";
    if (filter === "payments") return ["new_premium", "premium_modified", "new_payroll"].includes(item.eventType);
    return true;
  });
  const groups = [];
  filtered.forEach((item) => {
    const label = notificationGroupLabel(item.createdAt);
    const current = groups.at(-1);
    if (current?.label === label) current.rows.push(item);
    else groups.push({ label, rows: [item] });
  });

  return (
    <section className="notifications-page">
      <header className="notifications-hero">
        <div><small>Cambios del portal</small><h1>Centro de novedades</h1><p>Jornales, primas, nóminas y calendarios actualizados.</p></div>
        {notifications?.unread > 0 && <button type="button" onClick={onMarkAll}>Marcar todo leído</button>}
      </header>
      <div className="notifications-filters" role="tablist" aria-label="Filtrar novedades">
        {[
          ["all", "Todas"], ["unread", `Sin leer${notifications?.unread ? ` ${notifications.unread}` : ""}`],
          ["journals", "Jornales"], ["payments", "Pagos"]
        ].map(([id, label]) => <button key={id} type="button" className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{label}</button>)}
      </div>
      {loading ? <div className="notifications-state"><LoaderCircle className="is-spinning" size={24} /><strong>Cargando novedades…</strong></div>
        : error ? <div className="notifications-state is-error"><CircleAlert size={24} /><strong>{error}</strong></div>
          : groups.length ? groups.map((group) => (
            <section className="notifications-group" key={group.label}>
              <h2>{group.label}</h2>
              <div className="notifications-list">
                {group.rows.map((item) => {
                  const config = NOTIFICATION_TYPES[item.eventType] || NOTIFICATION_TYPES.new_journal;
                  const Icon = config.Icon;
                  return (
                    <button key={item.id} className={`notification-card is-${config.tone}${item.readAt ? " is-read" : " is-unread"}`} type="button" onClick={() => onOpen(item)}>
                      <span className="notification-icon"><Icon size={23} /></span>
                      <span className="notification-copy"><strong>{item.title}</strong><span>{item.body}</span><small>{config.label}</small></span>
                      <time>{notificationTime(item.createdAt)}</time>
                      {!item.readAt && <i aria-label="Sin leer" />}
                    </button>
                  );
                })}
              </div>
            </section>
          )) : <div className="notifications-empty"><Bell size={31} /><strong>No hay novedades</strong><span>{filter === "unread" ? "Has leído todas las novedades." : "Los próximos cambios del portal aparecerán aquí."}</span></div>}
    </section>
  );
}

function BottomNav({ activeTab, onChange }) {
  return (
    <nav className="bottom-nav" aria-label="Navegacion inferior">
      {BOTTOM_NAV_ITEMS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={activeTab === id ? "active" : ""}
          onClick={() => onChange(id)}
          aria-current={activeTab === id ? "page" : undefined}
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
  const [portalConnected, setPortalConnected] = useState(null);
  const [doorConfigLoadedFor, setDoorConfigLoadedFor] = useState("");
  const [portalSnapshotLoadedFor, setPortalSnapshotLoadedFor] = useState("");
  const [portalConnectionLoadedFor, setPortalConnectionLoadedFor] = useState("");
  const [portalRefreshQueued, setPortalRefreshQueued] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [portalCredentialsRequested, setPortalCredentialsRequested] = useState(false);
  const [chaperoLoaded, setChaperoLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState(() => tabFromHash(window.location.hash));
  const [activeSpecialtyId, setActiveSpecialtyId] = useState(() => getInitialSession()?.specialties?.[0] || specialty.id);
  const [notice, setNotice] = useState("");
  const [forumLatestId, setForumLatestId] = useState(0);
  const [forumHasUnread, setForumHasUnread] = useState(false);
  const [showForumIntro, setShowForumIntro] = useState(false);
  const [notifications, setNotifications] = useState({ rows: [], unread: 0 });
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const isAdmin = normalizeChapa(session?.chapa) === "72683";
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
  const homeInitialLoading = Boolean(
    session?.token
    && (
      doorConfigLoadedFor !== activeSpecialty.id
      || (session.portalActivationStatus !== "pending" && portalSnapshotLoadedFor !== session.token)
      || portalConnectionLoadedFor !== session.token
    )
  );

  useEffect(() => {
    const syncTabFromHash = () => {
      const nextTab = tabFromHash(window.location.hash);
      const allowedTab = nextTab === "monitor" && !isAdmin ? "inicio" : nextTab;
      setActiveTab(allowedTab);
      const canonicalHash = hashForTab(allowedTab);
      if (window.location.hash !== canonicalHash) window.history.replaceState(null, "", canonicalHash);
    };
    syncTabFromHash();
    window.addEventListener("hashchange", syncTabFromHash);
    return () => window.removeEventListener("hashchange", syncTabFromHash);
  }, [isAdmin]);

  const navigateToTab = (tab) => {
    const nextTab = tabFromHash(hashForTab(tab));
    if (nextTab === "foro") {
      markForumIntroSeen(session?.chapa);
      setShowForumIntro(false);
      if (forumLatestId) markForumRead(session?.chapa, forumLatestId);
      setForumHasUnread(false);
    }
    setMenuOpen(false);
    setActiveTab(nextTab);
    if (window.location.hash !== hashForTab(nextTab)) window.location.hash = hashForTab(nextTab);
  };

  const handleLatestForumMessage = useCallback((messageId) => {
    const latestId = Number(messageId) || 0;
    if (!latestId) return;
    setForumLatestId((current) => Math.max(current, latestId));
    if (activeTab === "foro") {
      markForumRead(session?.chapa, latestId);
      setForumHasUnread(false);
    } else {
      setForumHasUnread(latestId > getForumLastRead(session?.chapa));
    }
  }, [activeTab, session?.chapa]);

  const refreshNotifications = useCallback(async ({ quiet = false } = {}) => {
    if (!session?.token) return;
    if (!quiet) setNotificationsLoading(true);
    try {
      const result = await getUserNotifications({ token: session.token, limit: 100 });
      setNotifications({ rows: result?.rows || [], unread: Number(result?.unread || 0) });
      setNotificationsError("");
    } catch (error) {
      setNotificationsError(error?.message || "No se pudieron cargar las novedades.");
    } finally {
      if (!quiet) setNotificationsLoading(false);
    }
  }, [session?.token]);

  useEffect(() => {
    if (!session?.token) {
      setNotifications({ rows: [], unread: 0 });
      return undefined;
    }
    refreshNotifications();
    const timer = window.setInterval(() => refreshNotifications({ quiet: true }), 60_000);
    const onVisible = () => document.visibilityState === "visible" && refreshNotifications({ quiet: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshNotifications, session?.token]);

  const openNotification = async (item) => {
    if (!item.readAt) {
      const readAt = new Date().toISOString();
      setNotifications((current) => ({
        unread: Math.max(0, Number(current.unread || 0) - 1),
        rows: current.rows.map((row) => row.id === item.id ? { ...row, readAt } : row)
      }));
      markUserNotificationsRead({ token: session.token, notificationId: item.id }).catch(() => refreshNotifications({ quiet: true }));
    }
    navigateToTab(item.targetTab || "novedades");
  };

  const markAllNotificationsRead = async () => {
    const readAt = new Date().toISOString();
    setNotifications((current) => ({ unread: 0, rows: current.rows.map((row) => ({ ...row, readAt: row.readAt || readAt })) }));
    try {
      await markUserNotificationsRead({ token: session.token, all: true });
    } catch {
      await refreshNotifications({ quiet: true });
    }
  };

  useEffect(() => {
    if (activeTab !== "foro" || !session?.chapa) return;
    markForumIntroSeen(session.chapa);
    setShowForumIntro(false);
    if (forumLatestId) markForumRead(session.chapa, forumLatestId);
    setForumHasUnread(false);
  }, [activeTab, forumLatestId, session?.chapa]);

  useEffect(() => {
    if (!session?.token || !session?.chapa) {
      setForumLatestId(0);
      setForumHasUnread(false);
      setShowForumIntro(false);
      return undefined;
    }

    setShowForumIntro(!hasSeenForumIntro(session.chapa));
    let cancelled = false;
    const refreshForumStatus = async () => {
      try {
        const rows = await getForumMessages({ token: session.token, limit: 1 });
        if (!cancelled) handleLatestForumMessage(Number(rows?.[0]?.id) || 0);
      } catch {
        // El foro mostrara el error completo solo cuando el usuario lo abra.
      }
    };
    refreshForumStatus();
    const timer = window.setInterval(refreshForumStatus, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshForumStatus();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refreshForumStatus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refreshForumStatus);
    };
  }, [handleLatestForumMessage, session?.chapa, session?.token]);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activeTab]);

  const connectPortal = () => {
    setPortalCredentialsRequested(true);
    navigateToTab("portal");
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
    if (!session?.token) return undefined;
    let cancelled = false;

    const refreshActivation = async () => {
      try {
        const nextSession = await refreshCurrentUser({ token: session.token });
        if (cancelled || !nextSession) return;
        if (
          nextSession.portalActivationStatus === session.portalActivationStatus
          && nextSession.email === session.email
          && nextSession.displayName === session.displayName
          && Boolean(nextSession.forumShowChapa) === Boolean(session.forumShowChapa)
          && Number(nextSession.irpfRate) === Number(session.irpfRate)
        ) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
        setSession(nextSession);
      } catch {
        // La cuenta seguirá pendiente y se volverá a comprobar más adelante.
      }
    };

    refreshActivation();
    const timer = session.portalActivationStatus === "pending"
      ? window.setInterval(refreshActivation, 15_000)
      : null;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [session?.portalActivationStatus, session?.token]);

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
        setDoorConfigLoadedFor(activeSpecialty.id);
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
        if (!cancelled) {
          setDoorConfig(null);
          setDoorConfigLoadedFor(activeSpecialty.id);
        }
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
    if (!session.supportAccess) {
      trackUsageEvent({
        eventType: "app_open",
        chapa: session.chapa,
        metadata: { specialties: getEffectiveSpecialtyIds(session) }
      });
    }
    if (session.token && !session.supportAccess) {
      touchPortalActivity({ token: session.token })
        .then((status) => setPortalRefreshQueued(Boolean(status?.refreshQueued)))
        .catch(() => {});
    }
  }, [session?.chapa, session?.supportAccess, session?.token]);

  useEffect(() => {
    if (!session?.token) {
      setPortalSnapshot(null);
      setPortalConnected(null);
      return undefined;
    }
    if (session.portalActivationStatus === "pending") {
      setPortalSnapshot(null);
      setPortalConnected(null);
      return undefined;
    }
    let cancelled = false;
    let pollTimer = null;
    let stopTimer = null;
    let initialUpdatedAt = null;
    const loadPortalSnapshot = async () => {
      try {
        const data = await getOfficialPortalSnapshot({ token: session.token });
        if (!cancelled) {
          setPortalSnapshot(data || null);
          if (initialUpdatedAt === null) initialUpdatedAt = data?.updatedAt || "";
          else if ((data?.updatedAt || "") !== initialUpdatedAt && !data?.payload?.sync?.inProgress) {
            setPortalRefreshQueued(false);
          }
        }
      } catch {
        if (!cancelled) setPortalSnapshot(null);
      } finally {
        if (!cancelled) setPortalSnapshotLoadedFor(session.token);
      }
    };
    loadPortalSnapshot();
    if (portalRefreshQueued) {
      pollTimer = window.setInterval(loadPortalSnapshot, 15000);
      stopTimer = window.setTimeout(() => {
        if (pollTimer) window.clearInterval(pollTimer);
        pollTimer = null;
        setPortalRefreshQueued(false);
      }, 4 * 60 * 1000);
    }
    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
      if (stopTimer) window.clearTimeout(stopTimer);
    };
  }, [portalRefreshQueued, session?.portalActivationStatus, session?.token]);

  useEffect(() => {
    if (!session?.token) return undefined;

    let cancelled = false;
    const localCredentials = readPortalCredentials(session.chapa);
    setPortalConnected(localCredentials?.portalPassword ? true : null);

    getPortalAutoSyncStatus({ token: session.token })
      .then((status) => {
        if (!cancelled) setPortalConnected(Boolean(status?.enabled || localCredentials?.portalPassword));
      })
      .catch(() => {
        if (!cancelled && localCredentials?.portalPassword) setPortalConnected(true);
      })
      .finally(() => {
        if (!cancelled) setPortalConnectionLoadedFor(session.token);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.chapa, session?.token]);

  useEffect(() => {
    if (!session?.token || session.supportAccess || !activeTab || activeTab === "monitor") return;
    trackPageVisit({ token: session.token, page: activeTab });
  }, [activeTab, session?.supportAccess, session?.token]);

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
    if (!session.supportAccess) {
      trackUsageEvent({
        eventType: "specialties_update",
        chapa: session.chapa,
        metadata: { specialties: nextIds }
      });
    }
    if (!nextIds.includes(activeSpecialtyId)) setActiveSpecialtyId(nextIds[0]);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setMenuOpen(false);
    setSession(null);
    navigateToTab("inicio");
  };

  const savePassword = async ({ currentPassword, newPassword }) => {
    const response = await updateUserPassword({
      token: session.token,
      currentPassword,
      newPassword
    });
    const nextSession = response || session;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
    if (!session.supportAccess) {
      trackUsageEvent({ eventType: "password_change", chapa: session.chapa });
    }
  };

  const saveProfile = async ({ displayName, forumShowChapa }) => {
    const response = await updateUserProfile({
      token: session.token,
      displayName,
      forumShowChapa
    });
    const nextSession = response || { ...session, displayName, forumShowChapa };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
  };

  const deleteAccount = async ({ currentPassword, confirmation }) => {
    const chapa = session.chapa;
    await deleteUserAccount({
      token: session.token,
      currentPassword,
      confirmation
    });
    removeStoredUserData(chapa);
    setDeleteAccountOpen(false);
    setMenuOpen(false);
    setPortalSnapshot(null);
    setPortalConnected(null);
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
              setMenuOpen(false);
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
    <div className={`mobile-app${activeTab === "foro" ? " mobile-app-forum" : ""}`}>
      <AppHeader
        onMenuOpen={() => setMenuOpen(true)}
        unreadNotifications={notifications.unread}
        onNotificationsOpen={() => navigateToTab("novedades")}
      />
      <main className={`content${activeTab === "foro" ? " content-forum" : ""}`}>
        {activeTab === "inicio" && (
          homeInitialLoading
            ? <HomeInitialLoading />
            : <HomePanel
                user={displayUser}
                doors={doors}
                doorConfig={doorConfig}
                currentTime={currentTime}
                portalSnapshot={portalSnapshot}
                portalConnected={portalConnected}
                notice={notice}
                activeSpecialty={activeSpecialty}
                activeSpecialtyId={activeSpecialtyId}
                availableSpecialties={availableSpecialties}
                onSpecialtyChange={setActiveSpecialtyId}
                onLoadPortal={connectPortal}
                onNavigate={navigateToTab}
                showForumIntro={showForumIntro}
                displayName={session.displayName}
              />
        )}
        {activeTab === "contratacion" && <ContractingPanel snapshot={portalSnapshot} currentTime={currentTime} portalConnected={portalConnected} onLoadPortal={connectPortal} />}
        {activeTab === "sueldometro" && <PortalPanel view="salary" initialSnapshot={portalSnapshot} session={session} onSnapshotChange={setPortalSnapshot} onSessionChange={setSession} onConnectionChange={setPortalConnected} />}
        {activeTab === "descansos" && <PortalPanel view="rests" initialSnapshot={portalSnapshot} session={session} onSnapshotChange={setPortalSnapshot} onSessionChange={setSession} onConnectionChange={setPortalConnected} />}
        {activeTab === "excepciones" && <PortalPanel view="exceptions" initialSnapshot={portalSnapshot} session={session} onSnapshotChange={setPortalSnapshot} onSessionChange={setSession} onConnectionChange={setPortalConnected} />}
        {activeTab === "vacaciones" && <PortalPanel view="holidays" initialSnapshot={portalSnapshot} session={session} onSnapshotChange={setPortalSnapshot} onSessionChange={setSession} onConnectionChange={setPortalConnected} />}
        {activeTab === "nominas" && <PortalPanel view="payrolls" initialSnapshot={portalSnapshot} session={session} onSnapshotChange={setPortalSnapshot} onSessionChange={setSession} onConnectionChange={setPortalConnected} />}
        {activeTab === "novedades" && <NotificationsPanel notifications={notifications} loading={notificationsLoading} error={notificationsError} onOpen={openNotification} onMarkAll={markAllNotificationsRead} />}
        {activeTab === "estado" && (
          <OperationalStatusPanel
            user={displayUser}
            doors={doors}
            doorConfig={doorConfig}
            chaperoSnapshot={chaperoSnapshot}
            chaperoWorker={chaperoWorker}
            chaperoLoading={!chaperoLoaded}
            currentTime={currentTime}
            activeSpecialty={activeSpecialty}
            activeSpecialtyId={activeSpecialtyId}
            availableSpecialties={availableSpecialties}
            onSpecialtyChange={setActiveSpecialtyId}
          />
        )}
        {activeTab === "puertas" && (
          <DoorsPanel
            doors={doors}
            doorConfig={doorConfig}
            activeSpecialty={activeSpecialty}
            activeSpecialtyId={activeSpecialtyId}
            availableSpecialties={availableSpecialties}
            onSpecialtyChange={setActiveSpecialtyId}
          />
        )}
        {activeTab === "censo" && (
          <CensoPanel
            user={user}
            doors={doors}
            activeSpecialty={activeSpecialty}
            activeSpecialtyId={activeSpecialtyId}
            availableSpecialties={availableSpecialties}
            onSpecialtyChange={setActiveSpecialtyId}
          />
        )}
        {activeTab === "tablon" && (
          <GeneralBoard
            chapa={session.chapa}
            onOpen={(chapa) => {
              if (!session.supportAccess) trackUsageEvent({ eventType: "tablon_general_open", chapa });
            }}
          />
        )}
        {activeTab === "portal" && (
          <PortalPanel
            view="all"
            initialSnapshot={portalSnapshot}
            session={session}
            onSnapshotChange={setPortalSnapshot}
            onSessionChange={setSession}
            onConnectionChange={setPortalConnected}
            openCredentialsOnLoad={portalCredentialsRequested}
            onCredentialsRequestChange={setPortalCredentialsRequested}
          />
        )}
        {activeTab === "enlaces" && <LinksPanel />}
        {activeTab === "foro" && <ForumPanel session={session} onLatestMessage={handleLatestForumMessage} />}
        {activeTab === "monitor" && isAdmin && <AdminMonitor session={session} />}
        {activeTab !== "foro" && <ContactFooter />}
      </main>
      {passwordOpen && <ChangePasswordModal onClose={() => setPasswordOpen(false)} onSave={savePassword} />}
      {profileOpen && <ProfileSettingsModal session={session} onClose={() => setProfileOpen(false)} onSave={saveProfile} />}
      {deleteAccountOpen && <DeleteAccountModal chapa={session.chapa} onClose={() => setDeleteAccountOpen(false)} onDelete={deleteAccount} />}
      <SideMenu
        open={menuOpen}
        activeTab={activeTab}
        theme={theme}
        isAdmin={isAdmin}
        forumHasUnread={forumHasUnread}
        onClose={() => setMenuOpen(false)}
        onNavigate={navigateToTab}
        onProfileOpen={() => setProfileOpen(true)}
        onSettingsOpen={() => setPasswordOpen(true)}
        onPortalAccessOpen={connectPortal}
        onDeleteAccountOpen={() => setDeleteAccountOpen(true)}
        onThemeToggle={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
        onLogout={logout}
      />
      <BottomNav activeTab={activeTab} onChange={navigateToTab} />
    </div>
  );
}
