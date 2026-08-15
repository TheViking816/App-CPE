import { useEffect, useMemo, useRef, useState } from "react";
import { loadMonthlyPayrollPdfModule } from "./loadMonthlyPayrollPdf.js";
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
  FileDown,
  FileLock2,
  Eye,
  EyeOff,
  Home,
  Inbox,
  Link as LinkIcon,
  ClipboardList,
  Lock,
  LogOut,
  Menu,
  Moon,
  Mail,
  Percent,
  RefreshCw,
  ReceiptText,
  Search,
  Settings,
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
  getOfficialPortalDocument,
  getOfficialPortalSnapshot,
  getPortalAutoSyncStatus,
  getPortalSyncJob,
  loginUser,
  registerUser,
  requestAllPortalSyncs,
  requestOfficialPortalDocument,
  requestPortalSync,
  setPortalAutoSync,
  setPortalSecurityKey,
  trackPageVisit,
  trackUsageEvent,
  updateUserIrpf,
  updateUserPassword,
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
const DEFAULT_PORTAL_SYNC_SECONDS = 55;
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
      { id: "estado", label: "Estado operativo", Icon: BriefcaseBusiness },
      { id: "puertas", label: "Detalle de puertas", Icon: CalendarRange },
      { id: "tablon", label: "Tablón general", Icon: ClipboardList },
      { id: "censo", label: "Censo", Icon: UsersRound }
    ]
  },
  {
    label: "Recursos y cuenta",
    items: [
      { id: "nominas", label: "Nóminas", Icon: FileLock2 },
      { id: "enlaces", label: "Enlaces útiles", Icon: LinkIcon },
      { id: "portal", label: "Sincronización del portal", Icon: RefreshCw }
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

      {mode === "register" && <p className="login-hint">La app detectara tus especialidades por la chapa.</p>}
      {error && <p className="form-error">{error}</p>}

      <button className="primary-button" type="submit" disabled={loading}>
        {loading ? "Procesando..." : mode === "register" ? "Crear cuenta" : "Entrar"}
      </button>
    </form>
  );
}

function AppHeader({ user, messages, onInboxOpen, onMenuOpen }) {
  const unreadCount = (messages?.rows || []).filter((message) => !message.read).length;
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
      {user && (
        <button className="header-inbox-button" type="button" onClick={onInboxOpen} aria-label="Abrir bandeja de entrada">
          <Mail size={20} />
          {unreadCount > 0 && <span>{unreadCount > 99 ? "99+" : unreadCount}</span>}
        </button>
      )}
    </header>
  );
}

function SideMenu({ open, activeTab, theme, onClose, onNavigate, onSettingsOpen, onThemeToggle, onLogout }) {
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
                <Icon size={19} /><span>{label}</span><ChevronRight size={17} />
              </button>
            ))}
          </section>
        ))}
        <section className="side-menu-settings">
          <p>Ajustes</p>
          <button type="button" onClick={() => { onSettingsOpen(); onClose(); }}><Settings size={19} /><span>Cambiar contraseña</span><ChevronRight size={17} /></button>
          <button type="button" onClick={onThemeToggle}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}<span>{theme === "dark" ? "Modo claro" : "Modo oscuro"}</span><ChevronRight size={17} /></button>
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

function PayrollDocumentModal({ payroll, session, onClose }) {
  const [documentUrl, setDocumentUrl] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Buscando documento seguro...");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const loadDocument = async () => {
      let document = await getOfficialPortalDocument({ token: session.token, documentId: payroll.id });
      if (!document?.contentBase64) {
        setStatus("Descargando esta nómina del portal...");
        const job = await requestOfficialPortalDocument({ token: session.token, documentId: payroll.id });
        const deadline = Date.now() + 120000;
        while (active && Date.now() < deadline) {
          const jobStatus = await getPortalSyncJob({ token: session.token, jobId: job.jobId });
          if (jobStatus?.status === "failed") throw new Error(jobStatus.message || "No se pudo descargar la nómina.");
          document = await getOfficialPortalDocument({ token: session.token, documentId: payroll.id });
          if (document?.contentBase64) break;
          if (jobStatus?.status === "completed") throw new Error("El portal no devolvió el PDF de esta nómina.");
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }
      }
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
  }, [payroll.id, session.token]);

  return (
    <div className="document-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="document-modal" role="dialog" aria-modal="true" aria-labelledby="payroll-document-title">
        <header>
          <div><small>Nómina electrónica</small><h2 id="payroll-document-title">{payroll.title}</h2></div>
          {documentUrl && <a href={documentUrl} target="_blank" rel="noreferrer"><ExternalLink size={18} /> Abrir</a>}
          <button type="button" onClick={onClose} aria-label="Cerrar nómina"><X size={21} /></button>
        </header>
        {!documentUrl && !error && <p className="document-modal-status"><RefreshCw className="is-spinning" size={20} /> {status}</p>}
        {error && <p className="document-modal-status is-error"><CircleAlert size={20} /> {error}</p>}
        {documentUrl && (
          <div className="document-modal-download">
            <FileLock2 size={42} />
            <strong>{payroll.title}</strong>
            <span>Documento PDF protegido</span>
            <a href={documentUrl} target="_blank" rel="noreferrer"><ExternalLink size={18} /> Abrir nómina</a>
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
            <div className={payroll.primaVerification === "pending" ? "is-unverified-prima" : undefined}>
              <span>Prima</span><strong>{payroll.prima > 0 ? formatEuro(payroll.prima) : "Pendiente"}</strong>
            </div>
          )}
        </div>
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

function PortalMonthDetailModal({ month, irpfRate, onClose }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const rows = useMemo(
    () => [...(month?.enriched || [])].sort(compareJornalesDescending),
    [month]
  );
  const totals = useMemo(() => rows.reduce((summary, item) => ({
    base: summary.base + Number(item.payroll?.base || 0),
    complement: summary.complement + Number(item.payroll?.complement || 0),
    prima: summary.prima + Number(item.payroll?.prima || 0),
    gross: summary.gross + Number(item.payroll?.total || 0)
  }), { base: 0, complement: 0, prima: 0, gross: 0 }), [rows]);
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
      downloadMonthlyPayrollPdf(month, irpfRate);
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
        <div className="portal-month-financials">
          <div className="is-gross"><span>Bruto</span><strong>{formatEuro(totals.gross)}</strong></div>
          <div><span>Retención · {irpfRate}%</span><strong>-{formatEuro(withholding)}</strong></div>
          <div className="is-net"><span>Neto estimado</span><strong>{formatEuro(net)}</strong></div>
        </div>
        <div className="portal-month-breakdown">
          <div><span>Jornales</span><strong>{rows.length}</strong></div>
          <div><span>Bases</span><strong>{formatEuro(totals.base)}</strong></div>
          <div><span>Complementos</span><strong>{formatEuro(totals.complement)}</strong></div>
          <div><span>Primas</span><strong>{formatEuro(totals.prima)}</strong></div>
        </div>
        <div className="portal-month-jornales">
          <h2>Jornales del mes</h2>
          {rows.length === 0 && <p>Este mes no tiene jornales cargados.</p>}
          {rows.map((item, index) => (
            <article key={`${item.jornal || item.parte || item.dia}-${index}`}>
              <div className="portal-month-jornal-heading">
                <span><b>{item.dia || "-"}</b><small>{item.payroll?.shift || "Jornal"}</small></span>
                <div><strong>{item.especialidad || "Jornal"}</strong><small>{[item.buque, item.empresa].filter((value) => value && !/^(?:--?|—)$/.test(String(value).trim())).join(" · ")}</small></div>
                <strong>{formatEuro(item.payroll?.total)}</strong>
              </div>
              <div className="portal-month-jornal-values">
                <span>Base <b>{formatEuro(item.payroll?.base)}</b></span>
                <span>Complemento <b>{formatEuro(item.payroll?.complement || 0)}</b></span>
                {item.payroll?.operationType !== "RECEPCION_ENTREGA" && (
                  <span className={item.payroll?.primaVerification === "pending" ? "is-unverified-prima" : undefined}>
                    Prima <b>{item.payroll?.prima > 0 ? formatEuro(item.payroll.prima) : "Pendiente"}</b>
                  </span>
                )}
              </div>
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

function PortalConnectCallout({ compact = false, onConnect }) {
  return (
    <button className={`home-connect-callout${compact ? " compact" : ""}`} type="button" onClick={onConnect}>
      <span className="home-connect-icon"><RefreshCw size={22} /></span>
      <span>
        <small>Activa toda la aplicación</small>
        <strong>Conecta tu Portal CPE</strong>
        <span>Introduce tu contraseña del portal de SEVASA para cargar contratación, sueldo, descansos y vacaciones.</span>
      </span>
      <ChevronRight size={21} />
    </button>
  );
}

function HomePanel({
  user,
  doors,
  doorConfig,
  currentTime,
  portalSnapshot,
  notice,
  activeSpecialty,
  availableSpecialties,
  activeSpecialtyId,
  onSpecialtyChange,
  onLoadPortal,
  onNavigate
}) {
  const nearest = getNearestDoor(doors);
  const firstName = portalFirstName(portalSnapshot);
  const hasPortalData = Boolean(portalSnapshot?.payload);
  const directAccess = [
    { id: "sueldometro", title: "Sueldómetro", Icon: WalletCards, tone: "salary" },
    { id: "descansos", title: "Descansos", Icon: CalendarDays, tone: "rests" },
    { id: "vacaciones", title: "Vacaciones", Icon: Sun, tone: "holidays" }
  ];

  return (
    <section className="page-panel home-dashboard">
      <header className="home-welcome">
        <small>{formatCurrentDateTime(currentTime)}</small>
        <h1>{firstName ? `Hola, ${firstName}` : "Bienvenido/a"}</h1>
        {!hasPortalData && <span className="home-demo-badge">Vista previa · faltan datos del portal</span>}
      </header>

      {!hasPortalData && <PortalConnectCallout onConnect={onLoadPortal} />}

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

function ContractingPanel({ snapshot, currentTime, onLoadPortal }) {
  const hasPortalData = Boolean(snapshot?.payload);
  return (
    <section className="page-panel personal-route-panel">
      <div className="section-heading"><p>Próximos días</p><h1>Mi contratación</h1></div>
      {!hasPortalData && <PortalConnectCallout compact onConnect={onLoadPortal} />}
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

function DoorsPanel({ doors, doorConfig, activeSpecialty }) {
  const laborableDoors = doors.filter((door) => door.dayType === "laborable");
  const festivoDoors = doors.filter((door) => door.dayType === "festivo");

  return (
    <section className="page-panel">
      <div className="section-heading">
        <p>Puertas de turno</p>
        <h1>{getSpecialtyLabel(activeSpecialty)}</h1>
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

function PortalFeatureTemplate({ view = "all" }) {
  const templates = {
    salary: { Icon: WalletCards, eyebrow: "Estimación mensual", title: "Tu Sueldómetro", copy: "Aquí verás el neto estimado, tus jornales y el resumen anual.", labels: ["Neto estimado", "Jornales del mes", "Resumen anual"] },
    rests: { Icon: CalendarDays, eyebrow: "Calendario personal", title: "Tus descansos", copy: "Aquí aparecerán tus días DS, solicitudes SL y la posición correspondiente.", labels: ["Calendario de descansos", "Días SL", "Posiciones SL"] },
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

function PortalResultPreview({ snapshot, session, view = "all", onSessionChange, onLoadHistory, onRequestSecurityKey, onRequestCredentials, loadingHistory = false, hideSyncFailure = false }) {
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
  const hasDescansos = Array.isArray(descansos?.months) && descansos.months.length > 0;
  const slRows = payload?.sl?.rows || [];
  const vacaciones = payload?.vacaciones || null;
  const nominas = payload?.nominas || null;
  const hasNominas = Boolean(nominas?.recognized && !nominas?.locked && (nominas?.rows || []).length > 0);
  const needsSecurityKey = Boolean(payload?.primas?.locked || payload?.nominas?.locked);
  const [selectedPeriod, setSelectedPeriod] = useState("first");
  const [irpfRate, setIrpfRate] = useState(0);
  const [savedIrpfRate, setSavedIrpfRate] = useState(0);
  const [savingIrpf, setSavingIrpf] = useState(false);
  const [irpfMessage, setIrpfMessage] = useState("");
  const [irpfError, setIrpfError] = useState(false);
  const [jornalesExpanded, setJornalesExpanded] = useState(false);
  const [annualExpanded, setAnnualExpanded] = useState(false);
  const [nominasExpanded, setNominasExpanded] = useState(false);
  const [selectedJornal, setSelectedJornal] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [selectedPayroll, setSelectedPayroll] = useState(null);
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
  const currentHistoryMonth = new Date().getMonth() + 1;
  const hasFullCurrentYear = annualPayroll.months.filter((month) => (
    Number(month.year) === new Date().getFullYear()
  )).length >= currentHistoryMonth;
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

      {payload?.sync?.failed && !hideSyncFailure && (
        <button className="portal-sync-warning portal-security-prompt" type="button" onClick={onRequestCredentials}>
          <CircleAlert size={20} />
          <div>
            <strong>{payload.sync.stage || "No se pudo conectar con el portal"}</strong>
            <span>{payload.sync.error || "Revisa la contraseña del portal y vuelve a intentarlo."}</span>
          </div>
          <ChevronRight size={19} />
        </button>
      )}

      {payload?.sync?.partial && !payload?.sync?.inProgress && !payload?.sync?.failed && needsSecurityKey && (
        <button className="portal-sync-warning portal-security-prompt" type="button" onClick={onRequestSecurityKey}>
          <CircleAlert size={20} />
          <div><strong>Introduce tu clave de seguridad para cargar primas y nóminas</strong></div>
          <ChevronRight size={19} />
        </button>
      )}

      {view === "all" && (jornales.length > 0 || hasDescansos || vacaciones?.recognized || hasNominas) && (
        <nav className="portal-section-shortcuts" aria-label="Accesos a los datos del portal">
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
          {hasDescansos && (
            <button className="is-descansos" type="button" onClick={() => descansosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <CalendarDays size={19} /><span>Descansos</span><ChevronDown size={17} />
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

      {(view === "all" || view === "salary") && jornales.length > 0 && (
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
                        <button
                          key={`${month.year}-${month.month}`}
                          type="button"
                          title={`Abrir ${month.monthLabel}: ${month.count} jornales`}
                          aria-label={`Abrir detalle de ${month.monthLabel}, ${month.count} jornales`}
                          onClick={() => setSelectedMonth(month)}
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
          {!hasFullCurrentYear && (
            <button
              className="portal-history-action"
              type="button"
              disabled={loadingHistory}
              onClick={onLoadHistory}
            >
              <CalendarRange size={17} />
              {loadingHistory ? "Cargando historial..." : "Cargar todo el año"}
            </button>
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
                        <span className={item.payroll?.prima > 0
                          ? `is-prima${item.payroll?.primaVerification === "pending" ? " is-unverified" : ""}`
                          : "is-pending"}>
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

      {(view === "all" ? hasNominas : view === "payrolls" && nominas?.recognized) && (
        <section ref={nominasRef} className={`portal-personal-section portal-payroll-documents portal-scroll-anchor${nominasExpanded ? " is-open" : ""}`}>
          <button className="portal-payroll-toggle" type="button" onClick={() => setNominasExpanded((current) => !current)} aria-expanded={nominasExpanded}>
            <span className="portal-personal-icon is-payroll"><FileLock2 size={21} /></span>
            <span><small>Modo seguro</small><strong>Nómina electrónica</strong></span>
            {!nominas.locked && <b>{nominas.rows?.length || 0}</b>}
            <ChevronDown size={19} />
          </button>
          {nominasExpanded && (nominas.locked ? (
            <p className="portal-secure-empty"><Lock size={18} /><span><strong>Clave de seguridad necesaria</strong><small>Guárdala en Mi portal y actualiza para consultar tus nóminas.</small></span></p>
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

      {selectedMonth && <PortalMonthDetailModal month={selectedMonth} irpfRate={irpfRate} onClose={() => setSelectedMonth(null)} />}
      {selectedJornal && <PortalJornalDetailModal jornal={selectedJornal} onClose={() => setSelectedJornal(null)} />}
      {selectedPayroll && <PayrollDocumentModal payroll={selectedPayroll} session={session} onClose={() => setSelectedPayroll(null)} />}
      {view === "salary" && jornales.length === 0 && <PortalFeatureTemplate view="salary" />}
      {view === "rests" && !descansos && <PortalFeatureTemplate view="rests" />}
      {view === "holidays" && !vacaciones?.recognized && <PortalFeatureTemplate view="holidays" />}
      {view === "payrolls" && !nominas?.recognized && <PortalFeatureTemplate view="payrolls" />}
    </div>
  );
}

function PortalPanel({
  session,
  view = "all",
  onSnapshotChange,
  onSessionChange,
  openCredentialsOnLoad = false,
  onCredentialsRequestChange
}) {
  const initialCredentials = useMemo(() => readPortalCredentials(session.chapa), [session.chapa]);
  const initialActiveSync = useMemo(() => readPortalActiveSync(session.chapa), [session.chapa]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [portalPassword, setPortalPassword] = useState(initialCredentials?.portalPassword || "");
  const [securityKey, setSecurityKey] = useState(initialCredentials?.securityKey || "");
  const [savedCredentials, setSavedCredentials] = useState(initialCredentials);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(Boolean(initialCredentials));
  const [autoSyncLoading, setAutoSyncLoading] = useState(true);
  const [syncingPortal, setSyncingPortal] = useState(Boolean(initialActiveSync));
  const [portalJob, setPortalJob] = useState(initialActiveSync || null);
  const [portalMessage, setPortalMessage] = useState(initialActiveSync ? "Recuperando la sincronizacion en curso..." : "");
  const [showCredentials, setShowCredentials] = useState(false);
  const [securityKeyOnly, setSecurityKeyOnly] = useState(false);
  const [syncProgress, setSyncProgress] = useState(initialActiveSync ? 3 : 0);
  const [syncElapsed, setSyncElapsed] = useState(initialActiveSync ? Math.floor((Date.now() - initialActiveSync.startedAt) / 1000) : 0);
  const [syncingAllUsers, setSyncingAllUsers] = useState(false);
  const [allUsersMessage, setAllUsersMessage] = useState("");
  const syncStartedAtRef = useRef(initialActiveSync?.startedAt || 0);
  const syncEstimateRef = useRef(getPortalSyncEstimate(session.chapa));
  const lastProgressRefreshRef = useRef(0);
  const portalErrorRef = useRef(null);
  const credentialsRef = useRef(null);

  const loadSnapshot = async ({ silent = false } = {}) => {
    if (!silent) {
      setError("");
      setLoading(true);
    }
    try {
      const data = await getOfficialPortalSnapshot({ token: session.token });
      setSnapshot(data || null);
      onSnapshotChange?.(data || null);
      const credentialsRejected = Boolean(data?.payload?.sync?.failed);
      setShowCredentials(!data || credentialsRejected);
      if (credentialsRejected) {
        setError("");
        setPortalMessage("");
        setSecurityKeyOnly(false);
        setPortalPassword("");
      }
    } catch (requestError) {
      if (!silent) {
        setError(requestError.message || "No se pudo leer el portal sincronizado.");
        setShowCredentials(true);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadSnapshot();
  }, [session.token]);

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
          await loadSnapshot();
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

  const handlePortalSync = async ({ fullHistory = false } = {}) => {
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
    setPortalMessage(fullHistory ? "Lanzando la carga del historial anual..." : "Lanzando lectura del portal...");
    setSyncingPortal(true);
    setSyncProgress(3);
    setSyncElapsed(0);
    syncEstimateRef.current = getPortalSyncEstimate(session.chapa);
    syncStartedAtRef.current = Date.now();

    try {
      if (securityKeyOnly && securityKeyToUse) {
        await setPortalSecurityKey({ token: session.token, securityKey: securityKeyToUse });
      } else if (passwordToUse) {
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
        securityKey: securityKeyToUse,
        fullHistory
      });
      writePortalCredentials(session.chapa, null);
      setSavedCredentials(null);
      setPortalPassword("");
      setSecurityKey("");
      setSecurityKeyOnly(false);
      setPortalJob(job);
      writePortalActiveSync(session.chapa, {
        jobId: job.jobId,
        status: job.status || "queued",
        startedAt: syncStartedAtRef.current
      });
      setShowCredentials(false);
      setPortalMessage(fullHistory
        ? "Cargando el historial anual. El resumen se añadirá al terminar."
        : "Lectura en curso. La app se actualizara automaticamente al terminar.");
    } catch (requestError) {
      setPortalMessage("");
      setSyncingPortal(false);
      setError(requestError.message || "No se pudo lanzar la lectura del portal.");
    }
  };

  const changeCredentials = () => {
    writePortalCredentials(session.chapa, null);
    setSavedCredentials(null);
    setPortalPassword("");
    setSecurityKey("");
    setError("");
    setSecurityKeyOnly(false);
    setShowCredentials(true);
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

  const syncRemaining = Math.max(0, Math.ceil(syncEstimateRef.current - syncElapsed));
  const isPortalAdmin = normalizeChapa(session.chapa) === "72683";

  const handleAllUsersSync = async () => {
    if (!window.confirm("Se actualizaran los datos de todos los usuarios con claves guardadas. ¿Continuar?")) return;

    setSyncingAllUsers(true);
    setAllUsersMessage("");
    try {
      const result = await requestAllPortalSyncs({ token: session.token });
      const queued = Number(result?.queued || 0);
      const skipped = Number(result?.skipped || 0);
      setAllUsersMessage(queued > 0
        ? `${queued} usuarios puestos en cola${skipped ? `; ${skipped} ya estaban actualizandose o no pudieron incluirse` : ""}.`
        : skipped > 0
          ? "No se han duplicado trabajos: todos los usuarios ya estaban actualizandose o no pudieron incluirse."
          : "No hay usuarios con sincronizacion automatica activa.");
    } catch (requestError) {
      setAllUsersMessage(requestError.message || "No se pudo lanzar la actualizacion general.");
    } finally {
      setSyncingAllUsers(false);
    }
  };
  const panelCopy = {
    all: { eyebrow: "Portal oficial", title: "Sincronización del portal" },
    salary: { eyebrow: "Jornales y salario", title: "Sueldómetro" },
    rests: { eyebrow: "Calendario personal", title: "Descansos" },
    holidays: { eyebrow: "Planificación", title: "Vacaciones" },
    payrolls: { eyebrow: "Documentos personales", title: "Nóminas" }
  }[view] || { eyebrow: "Portal oficial", title: "Mi portal" };

  return (
    <section className="page-panel portal-panel">
      <div className="section-heading">
        <p>{panelCopy.eyebrow}</p>
        <h1>{panelCopy.title}</h1>
      </div>

      {snapshot && !showCredentials && (
        <div className="portal-update-row">
          <span>
            Datos guardados del portal oficial
            {autoSyncEnabled && <small>Sincronizacion automatica cada hora, tambien a las 07:30, 12:30 y 14:45</small>}
          </span>
          <div>
            {autoSyncEnabled && <button className="portal-forget-button" type="button" onClick={changeCredentials}>Cambiar claves</button>}
            {autoSyncEnabled && (
              <button className="portal-forget-button" type="button" disabled={autoSyncLoading} onClick={disableAutoSync}>
                Desactivar auto
              </button>
            )}
            <button type="button" disabled={syncingPortal} onClick={(savedCredentials || autoSyncEnabled) ? () => handlePortalSync() : () => setShowCredentials(true)}>
              <RefreshCw size={16} className={syncingPortal ? "is-spinning" : ""} />
              {syncingPortal ? "Actualizando" : "Actualizar portal"}
            </button>
          </div>
        </div>
      )}

      {isPortalAdmin && (
        <section className="portal-admin-sync-card">
          <span className="portal-admin-sync-icon"><UsersRound size={22} /></span>
          <div>
            <small>Administracion</small>
            <strong>Actualizar todos los usuarios</strong>
            <p>Sincroniza las cuentas que tienen claves guardadas y la actualizacion automatica activa.</p>
          </div>
          <button type="button" disabled={syncingAllUsers} onClick={handleAllUsersSync}>
            <RefreshCw size={17} className={syncingAllUsers ? "is-spinning" : ""} />
            {syncingAllUsers ? "Lanzando..." : "Actualizar todos"}
          </button>
          {allUsersMessage && <p className="portal-admin-sync-message" role="status">{allUsersMessage}</p>}
        </section>
      )}

      {error && <p ref={portalErrorRef} className="portal-warning">{error}</p>}

      {showCredentials && !syncingPortal && (
        <>
          <p className="portal-first-sync-note">
            La espera solo es necesaria la primera vez. Después la app actualizará tus datos automáticamente en segundo plano.
          </p>

          <section ref={credentialsRef} className="portal-security-card">
            <div>
              <p>{securityKeyOnly ? "Añadir clave de seguridad" : snapshot ? "Actualizar portal" : "Conectar con el portal"}</p>
              <span>{securityKeyOnly
                ? "Introduce la clave de seguridad de primas y nóminas."
                : "Introduce tu contraseña del portal de SEVASA. La clave de seguridad es opcional y solo se usa para consultar primas y nóminas."}</span>
            </div>
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
              {snapshot && !syncingPortal && (
                <button className="secondary-button" type="button" onClick={() => setShowCredentials(false)}>
                  Cancelar
                </button>
              )}
              <button
                className="primary-button"
                type="button"
                disabled={syncingPortal || (securityKeyOnly ? !securityKey.trim() : !portalPassword.trim())}
                onClick={() => handlePortalSync()}
              >
                {syncingPortal ? "Leyendo portal..." : securityKeyOnly ? "Guardar y actualizar" : "Leer portal"}
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

      {syncingPortal && !snapshot?.payload ? (
        <div className="portal-empty-state">
          <RefreshCw className="is-spinning" size={26} />
          <strong>Conectado con el portal</strong>
          <span>Los primeros datos aparecerán aquí en unos segundos mientras continúa la lectura.</span>
        </div>
      ) : loading && !snapshot ? (
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
          onLoadHistory={() => handlePortalSync({ fullHistory: true })}
          onRequestSecurityKey={requestSecurityKey}
          onRequestCredentials={changeCredentials}
          loadingHistory={syncingPortal}
          hideSyncFailure={showCredentials}
        />
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
  const [inboxOpen, setInboxOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [portalCredentialsRequested, setPortalCredentialsRequested] = useState(false);
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
    setMenuOpen(false);
    setActiveTab(nextTab);
    if (window.location.hash !== hashForTab(nextTab)) window.location.hash = hashForTab(nextTab);
  };

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
    if (!session?.token || !activeTab) return;
    trackPageVisit({ token: session.token, page: activeTab });
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
    trackUsageEvent({ eventType: "password_change", chapa: session.chapa });
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
    <div className="mobile-app">
      <AppHeader
        user={session}
        messages={portalSnapshot?.payload?.mensajes}
        onInboxOpen={() => setInboxOpen(true)}
        onMenuOpen={() => setMenuOpen(true)}
      />
      <main className="content">
        {activeTab === "inicio" && (
          <HomePanel
            user={displayUser}
            doors={doors}
            doorConfig={doorConfig}
            currentTime={currentTime}
            portalSnapshot={portalSnapshot}
            notice={notice}
            activeSpecialty={activeSpecialty}
            activeSpecialtyId={activeSpecialtyId}
            availableSpecialties={availableSpecialties}
            onSpecialtyChange={setActiveSpecialtyId}
            onLoadPortal={connectPortal}
            onNavigate={navigateToTab}
          />
        )}
        {activeTab === "contratacion" && <ContractingPanel snapshot={portalSnapshot} currentTime={currentTime} onLoadPortal={connectPortal} />}
        {activeTab === "sueldometro" && <PortalPanel view="salary" session={session} onSnapshotChange={setPortalSnapshot} onSessionChange={setSession} />}
        {activeTab === "descansos" && <PortalPanel view="rests" session={session} onSnapshotChange={setPortalSnapshot} onSessionChange={setSession} />}
        {activeTab === "vacaciones" && <PortalPanel view="holidays" session={session} onSnapshotChange={setPortalSnapshot} onSessionChange={setSession} />}
        {activeTab === "nominas" && <PortalPanel view="payrolls" session={session} onSnapshotChange={setPortalSnapshot} onSessionChange={setSession} />}
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
        {activeTab === "puertas" && <DoorsPanel doors={doors} doorConfig={doorConfig} activeSpecialty={activeSpecialty} />}
        {activeTab === "censo" && <CensoPanel user={user} doors={doors} activeSpecialty={activeSpecialty} />}
        {activeTab === "tablon" && (
          <GeneralBoard
            chapa={session.chapa}
            onOpen={(chapa) => trackUsageEvent({ eventType: "tablon_general_open", chapa })}
          />
        )}
        {activeTab === "portal" && (
          <PortalPanel
            view="all"
            session={session}
            onSnapshotChange={setPortalSnapshot}
            onSessionChange={setSession}
            openCredentialsOnLoad={portalCredentialsRequested}
            onCredentialsRequestChange={setPortalCredentialsRequested}
          />
        )}
        {activeTab === "enlaces" && <LinksPanel />}
        <ContactFooter />
      </main>
      {inboxOpen && <InboxModal messages={portalSnapshot?.payload?.mensajes} onClose={() => setInboxOpen(false)} />}
      {passwordOpen && <ChangePasswordModal onClose={() => setPasswordOpen(false)} onSave={savePassword} />}
      <SideMenu
        open={menuOpen}
        activeTab={activeTab}
        theme={theme}
        onClose={() => setMenuOpen(false)}
        onNavigate={navigateToTab}
        onSettingsOpen={() => setPasswordOpen(true)}
        onThemeToggle={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
        onLogout={logout}
      />
      <BottomNav activeTab={activeTab} onChange={navigateToTab} />
    </div>
  );
}
