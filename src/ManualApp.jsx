import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase, loginUser, updateUserPassword, updateUserProfile, refreshCurrentUser, getUserManualPremiums, setUserManualPremium, getUserRelayHours, setUserRelayHour, getUserRemateHours, loadPayrollConfig, updateUserIrpf, trackUsageEvent, trackPageVisit, getUsageMonitor, getUserNotifications, markUserNotificationsRead, canOpenNorayLinks } from './supabaseClient.js';
import { touchDirectPresence } from './exchangeClient.js';
import { EXCHANGE_PREVIEW_READ_ONLY } from './exchangePreview.js';
import RestExchangePanel from './RestExchangePanel.jsx';
import VacationExchangePanel from './VacationExchangePanel.jsx';
import ExchangeConversations, { conversationHash, directConversationHash } from './ExchangeConversations.jsx';
import { hashForExchangeOffer } from './navigation.js';
import { buildManualSalaryMonths, companyImage, salaryPeriod, sharedPremiumRequest } from './manualSalary.js';
import { TRAINING_DAY_RATE, VACATION_DAY_RATE, enrichJornales, formatEuro, reconcileContinuousDoubleMeals } from './payroll.js';
import { optionsForGroup } from './manualSpecialties.js';
import { specialties as censoSpecialties } from './censo.js';
import { PROFESSIONAL_GROUPS, professionalGroupCode } from './professionalGroups.js';
import { REST_GROUPS } from './restGroups.js';
import { packManualNotes, unpackManualNotes } from './manualMetadata.js';
import { companySelectValue } from './manualCompany.js';
import { planPortalJornalesImport } from './portalJornalesPaste.js';
import PortalJornalesImport from './PortalJornalesImport.jsx';
import { ManualSalaryDashboard } from './ManualSalaryDashboard.jsx';
import UpcomingAssignments from './UpcomingAssignments.jsx';
import { loadNorayPilotSnapshot, loadNorayPilotPremiums, mergeNorayPilotSalary } from './norayPilot.js';
import GeneralBoard from './GeneralBoard.jsx';
import ManualOperationalSnapshots from './ManualOperationalSnapshots.jsx';
import PersonalNoraySectionLink from './PersonalNoraySectionLink.jsx';
import PortalCredentialPilot from './PortalCredentialPilot.jsx';
import { Activity, Bell, BriefcaseBusiness, CalendarDays, ChevronRight, ClipboardList, DoorOpen, ExternalLink, Eye, EyeOff, House, KeyRound, LogOut, MessageCircle, Settings, Trash2, WalletCards, X } from 'lucide-react';
import { enablePushNotifications, refreshPushSubscription, disablePushNotifications, optOutPushNotifications, testDeviceNotification } from './pushNotifications.js';

const SESSION_KEY = 'app-cpe-session';
const appLogo = `${import.meta.env.BASE_URL}logo.jpg`;
const OPERATIONAL_PAGES = new Set(['tablon', 'puertas', 'chapero']);
// Personal contracting is available to every account; the separate mobile reader remains manual.
const CONTRACTING_ENABLED = true;
const ACTIVE_PAGES = new Set(['sueldometro', 'descansos', 'vacaciones', 'conversaciones', 'novedades', 'cuenta', 'perfil', ...OPERATIONAL_PAGES, ...(CONTRACTING_ENABLED ? ['contratacion'] : [])]);
const ACTIVE_NOTIFICATION_TYPES = new Set(['new_journal', 'new_premium', 'journal_updated', 'premium_updated', 'rest_offer_published', 'rest_proposal', 'rest_response', 'rest_message', 'vacation_offer_published', 'vacation_proposal', 'vacation_response', 'vacation_message', 'direct_message']);
const viewFromHash = () => {
  const route = window.location.hash.split('/')[1]?.split('?')[0];
  return route === 'novedades' || ACTIVE_PAGES.has(route) ? route : 'sueldometro';
};
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const blank = () => ({ id: null, work_date: today(), shift: '08-14', specialty: optionsForGroup('II')[0], worker_group: 'II', operation_type: 'ESTIBA', company: '', vessel: '', premium: '', part: '', notes: '' });
const readSession = () => { try { const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return value?.token && value?.chapa ? value : null; } catch { return null; } };
const euroInput = (value) => Number(String(value).replace(',', '.'));

function ManualSideMenu({ tab, isAdmin, showContracting, navigate, onClose, onLogout, onDeleteAccount }) {
  const [settingsOpen, setSettingsOpen] = useState(tab === 'cuenta' || tab === 'perfil');
  const item = (page, label, Icon) => <button key={page} type="button" className={tab === page ? 'is-active' : ''} aria-current={tab === page ? 'page' : undefined} onClick={() => navigate(page)}>
    <Icon size={19} aria-hidden="true" /><span>{label}</span><ChevronRight size={16} aria-hidden="true" />
  </button>;
  return <nav className="visual-menu" aria-label="Menú principal">
    <div className="visual-menu-heading"><strong>Secciones</strong><button type="button" aria-label="Cerrar menú" onClick={onClose}><X size={18} /></button></div>
    <div className="visual-menu-group">
      <small>MI CUENTA</small>
      {showContracting && item('contratacion', 'Mi contratación', House)}
      {item('sueldometro', 'Sueldómetro', WalletCards)}
    </div>
    <div className="visual-menu-group">
      <small>OPERATIVA</small>
      {item('tablon', 'Tablón general', ClipboardList)}
      {item('puertas', 'Puertas de turno', DoorOpen)}
      {item('chapero', 'Chapero', BriefcaseBusiness)}
    </div>
    <div className="visual-menu-group">
      <small>COMUNIDAD</small>
      {item('descansos', 'Intercambios', CalendarDays)}
      {item('conversaciones', 'Chats privados', MessageCircle)}
    </div>
    <div className="visual-menu-group visual-menu-footer">
      {isAdmin && item('monitor', 'Monitor de actividad', Activity)}
      <button type="button" className={tab === 'cuenta' || tab === 'perfil' ? 'is-active' : ''} aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}><Settings size={19} aria-hidden="true" /><span>Ajustes</span><ChevronRight className={settingsOpen ? 'is-open' : ''} size={16} aria-hidden="true" /></button>
      {settingsOpen && <div id="manual-settings-submenu" className="visual-menu-group visual-menu-submenu">{item('perfil', 'Mis datos', WalletCards)}{item('cuenta', 'Cambiar contraseña', KeyRound)}</div>}
      <button type="button" className="menu-signout" onClick={onLogout}><LogOut size={19} aria-hidden="true" /><span>Salir</span></button>
      <button type="button" className="menu-delete-account" onClick={onDeleteAccount}><Trash2 size={19} aria-hidden="true" /><span>Eliminar cuenta</span></button>
    </div>
  </nav>;
}

function SectionPage({ eyebrow, title, children }) {
  return <div className="manual-section-page">
    <section className="visual-page-heading"><div><span>{eyebrow}</span><h1>{title}</h1></div></section>
    {children}
  </div>;
}

function ProfileFields({ professionalGroup, setProfessionalGroup, restGroup, setRestGroup, selectedSpecialties, setSelectedSpecialties, professionalGroupSource }) {
  const [otherSelected, setOtherSelected] = useState(false);
  const otherProfessionalGroup = otherSelected || Boolean(professionalGroup && !PROFESSIONAL_GROUPS.some((group) => group.code === professionalGroup));
  const toggleSpecialty = (id) => setSelectedSpecialties((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  return <div className="manual-profile-fields">
    <label>Grupo profesional de intercambio<select value={otherProfessionalGroup ? 'other' : professionalGroup} onChange={(event) => {
      const value = event.target.value; setOtherSelected(value === 'other'); setProfessionalGroup(value === 'other' ? '' : value);
    }} required>
      <option value="">Selecciona tu grupo de intercambio</option>{PROFESSIONAL_GROUPS.map((group) => <option key={group.code} value={group.code}>{group.label}</option>)}
      <option value="other">Otro grupo del portal</option>
    </select>{professionalGroupSource === 'portal' && <small>Seleccionado desde el portal. Puedes cambiarlo y guardar tu elección.</small>}</label>
    {otherProfessionalGroup && <label>Código del grupo en el portal<input value={professionalGroup} onChange={(event) => setProfessionalGroup(event.target.value.toUpperCase().trim())} placeholder="Por ejemplo, G-B" pattern="(G|SIN)-[A-Z0-9]{1,5}" maxLength={10} required /></label>}
    <label>Grupo de descansos<select value={restGroup} onChange={(event) => setRestGroup(event.target.value)} required>
      <option value="">Selecciona tu grupo</option>{REST_GROUPS.map((group) => <option key={group} value={group}>{group.replace(/\s+/g, '')}</option>)}
    </select></label>
    {[{ title: 'Especialidades', polivalencia: false }, { title: 'Polivalencias', polivalencia: true }].map((group) => <fieldset key={group.title}><legend>{group.title} <small>Selecciona todas las que tengas</small></legend>
      <div className="manual-profile-specialties">{censoSpecialties.filter((specialty) => specialty.name.trim().toUpperCase().startsWith('POL.') === group.polivalencia).map((specialty) => <label key={specialty.id}>
        <input type="checkbox" checked={selectedSpecialties.includes(specialty.id)} onChange={() => toggleSpecialty(specialty.id)} />
        <span>{specialty.name}</span>
      </label>)}</div>
    </fieldset>)}
  </div>;
}

function ProfileSettings({ session, onSession }) {
  const [displayName, setDisplayName] = useState(session.displayName || '');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState('');
  const [nameNotice, setNameNotice] = useState('');
  const [professionalGroup, setProfessionalGroup] = useState(professionalGroupCode(session.professionalGroup));
  const [restGroup, setRestGroup] = useState(session.restGroup || '');
  const [selectedSpecialties, setSelectedSpecialties] = useState(session.specialties || []);
  useEffect(() => {
    setDisplayName(session.displayName || '');
    setProfessionalGroup(professionalGroupCode(session.professionalGroup));
    setRestGroup(session.restGroup || '');
    setSelectedSpecialties(session.specialties || []);
  }, [session.displayName, session.professionalGroup, session.restGroup, session.specialties]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function saveName(event) {
    event.preventDefault(); setNameError(''); setNameNotice('');
    const name = displayName.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 40 || /[<>\x00-\x1f\x7f]/.test(name)) {
      setNameError('Introduce un nombre de entre 1 y 40 caracteres.');
      return;
    }
    setNameBusy(true);
    try {
      const response = await updateUserProfile({ token: session.token, displayName: name, forumShowChapa: session.forumShowChapa });
      const next = { ...session, ...response };
      localStorage.setItem(SESSION_KEY, JSON.stringify(next)); onSession(next);
      setDisplayName(next.displayName || name);
      setNameNotice('Nombre guardado. Tus compañeros ya lo verán en chats e intercambios.');
    } catch (reason) { setNameError(reason.message || 'No se pudo guardar el nombre.'); }
    finally { setNameBusy(false); }
  }
  async function submit(event) {
    event.preventDefault(); setError(''); setNotice('');
    if (!selectedSpecialties.length) { setError('Selecciona al menos una especialidad.'); return; }
    setBusy(true);
    try {
      const response = await rpc('app_cpe_update_manual_profile', { p_token: session.token, p_professional_group: professionalGroup, p_rest_group: restGroup, p_specialties: selectedSpecialties });
      const next = { ...session, ...response };
      localStorage.setItem(SESSION_KEY, JSON.stringify(next)); onSession(next);
      setProfessionalGroup(professionalGroupCode(response.professionalGroup));
      setNotice('Tus datos se han guardado.');
    } catch (reason) { setError(reason.message || 'No se pudieron guardar los datos.'); }
    finally { setBusy(false); }
  }
  return <SectionPage eyebrow="AJUSTES" title="Mis datos"><section className="manual-panel manual-profile-settings manual-profile-name">
    <h2>Nombre visible</h2>
    <p>Escribe el nombre que verán tus compañeros en chats e intercambios de descansos y vacaciones.</p>
    <form onSubmit={saveName}>
      <label htmlFor="manual-display-name">Tu nombre</label>
      <input id="manual-display-name" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} placeholder="Nombre y apellidos" required />
      {nameError && <p className="form-error" role="alert">{nameError}</p>}
      {nameNotice && <p className="banner success" role="status">{nameNotice}</p>}
      <button className="primary" disabled={nameBusy || !displayName.trim()}>{nameBusy ? 'Guardando…' : 'Guardar nombre'}</button>
    </form>
  </section><section className="manual-panel manual-profile-settings">
    <form onSubmit={submit}>
      <ProfileFields {...{ professionalGroup, setProfessionalGroup, restGroup, setRestGroup, selectedSpecialties, setSelectedSpecialties }} professionalGroupSource={session.professionalGroupSource} />
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="banner success" role="status">{notice}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar mis datos'}</button>
    </form>
  </section><PersonalNoraySectionLink session={session} section="mis-especialidades" label="Abrir mis especialidades" cardTitle="Especialidades del portal" /><PersonalNoraySectionLink session={session} section="solicito-formacion" label="Solicitar formación" cardTitle="Formación del portal" /><PortalCredentialPilot session={session} /></SectionPage>;
}

function PasswordSettings({ session }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(event) {
    event.preventDefault();
    setError(''); setNotice('');
    if (newPassword !== confirmPassword) { setError('Las contraseñas nuevas no coinciden.'); return; }
    setBusy(true);
    try {
      await updateUserPassword({ token: session.token, currentPassword, newPassword });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setNotice('Contraseña actualizada. Puedes seguir usando esta sesión.');
    } catch (reason) { setError(reason.message || 'No se pudo cambiar la contraseña.'); }
    finally { setBusy(false); }
  }
  return <SectionPage eyebrow="MI CUENTA" title="Cambiar contraseña">
    <section className="manual-panel password-settings">
      <p>Introduce tu contraseña actual y elige una nueva para App CPE.</p>
      <form onSubmit={submit}>
        <label>Contraseña actual<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
        <label>Contraseña nueva<input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
        <label>Repite la contraseña nueva<input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="banner success" role="status">{notice}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
      </form>
    </section>
  </SectionPage>;
}

async function rpc(name, values) {
  if (!supabase) throw new Error('Falta la configuración de la base de datos.');
  const { data, error } = await supabase.rpc(name, values);
  if (error) throw error;
  return data;
}

function Access({ onAccess }) {
  const [register, setRegister] = useState(false);
  const [chapa, setChapa] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [professionalGroup, setProfessionalGroup] = useState('');
  const [restGroup, setRestGroup] = useState('');
  const [selectedSpecialties, setSelectedSpecialties] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (register && !selectedSpecialties.length) throw new Error('Selecciona al menos una especialidad.');
      const name = displayName.trim().replace(/\s+/g, ' ');
      if (register && name && (name.length > 40 || /[<>\x00-\x1f\x7f]/.test(name))) {
        throw new Error('Introduce un nombre de hasta 40 caracteres, sin símbolos < o >.');
      }
      const session = register
        ? await rpc('app_cpe_register_manual_profile_named', { p_chapa: chapa, p_password: password, p_email: null, p_professional_group: professionalGroup, p_rest_group: restGroup, p_specialties: selectedSpecialties, p_display_name: name || null })
        : await loginUser({ chapa, password });
      if (!session?.token) throw new Error('No se pudo abrir la sesión.');
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      if (!session.supportAccess && String(session.chapa) !== '72683') trackUsageEvent({ eventType: register ? 'register' : 'login', chapa: session.chapa }).catch(() => {});
      onAccess(session);
    } catch (reason) { setError(reason.message || 'No se pudo acceder.'); }
    finally { setBusy(false); }
  }
  return <main className="manual-shell access-shell"><section className={`access-card${register ? ' is-registering' : ''}`}>
    <img className="brand-logo access-logo" src={appLogo} alt="Centro Portuario de Empleo de Valencia" />
    <form onSubmit={submit}>
      <label>Chapa<input value={chapa} onChange={(event) => setChapa(event.target.value)} inputMode="numeric" autoComplete="username" required /></label>
      {register && <label>Nombre (opcional)<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" maxLength={40} placeholder="Nombre que verán tus compañeros" /><small>Se mostrará en chats e intercambios. Puedes cambiarlo en Mis datos.</small></label>}
      <label>Contraseña<span className="access-password-field"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : undefined} required /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></span></label>
      {register && <ProfileFields {...{ professionalGroup, setProfessionalGroup, restGroup, setRestGroup, selectedSpecialties, setSelectedSpecialties }} />}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Un momento…' : register ? 'Crear cuenta' : 'Entrar'}</button>
    </form>
    <button className="text-button" type="button" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Ya tengo cuenta' : 'Crear cuenta nueva'}</button>
    {!register && <small>¿No recuerdas tu contraseña? <a href="mailto:portalestibavlc@gmail.com">portalestibavlc@gmail.com</a></small>}
    {register && <small>Esta contraseña es exclusiva de App CPE; no uses la del portal.</small>}
  </section></main>;
}

function ActivityMonitor({ session }) {
  const displayLimit = 10;
  const [data, setData] = useState(null);
  const [journalEvents, setJournalEvents] = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [registrations, setRegistrations] = useState(null);
  const [registrationError, setRegistrationError] = useState('');
  const [registrationLimit, setRegistrationLimit] = useState(10);
  const [personalLinks, setPersonalLinks] = useState(null);
  const [partOpens, setPartOpens] = useState(null);
  const [partOpenError, setPartOpenError] = useState('');
  const [pushActivations, setPushActivations] = useState(null);
  const [pushActivationError, setPushActivationError] = useState('');
  const [pushDeliveries, setPushDeliveries] = useState(null);
  const [pushDeliveryError, setPushDeliveryError] = useState('');
  const [personalLinkError, setPersonalLinkError] = useState('');
  const [personalLinkLimit, setPersonalLinkLimit] = useState(10);
  const [error, setError] = useState('');
  const [journalError, setJournalError] = useState('');
  const [calendarError, setCalendarError] = useState('');
  const [filter, setFilter] = useState('');
  const load = async () => {
    const [usage, journals, calendar, signups, linkOpens, partActivity, pushActivity, deliveryActivity] = await Promise.allSettled([
      getUsageMonitor({ token: session.token }),
      rpc('app_cpe_admin_manual_jornal_activity', { p_token: session.token }),
      rpc('app_cpe_admin_calendar_day_activity', { p_token: session.token }),
      rpc('app_cpe_admin_registration_monitor', { p_token: session.token }),
      rpc('app_cpe_admin_personal_link_monitor', { p_token: session.token }),
      rpc('app_cpe_admin_part_open_monitor', { p_token: session.token }),
      rpc('app_cpe_admin_push_activation_monitor', { p_token: session.token }),
      rpc('app_cpe_admin_push_delivery_monitor', { p_token: session.token })
    ]);
    if (usage.status === 'fulfilled') { setData(usage.value); setError(''); }
    else setError(usage.reason?.message || 'No se pudo cargar la actividad.');
    if (journals.status === 'fulfilled') { setJournalEvents(journals.value || []); setJournalError(''); }
    else setJournalError(journals.reason?.message || 'No se pudieron cargar los jornales.');
    if (calendar.status === 'fulfilled') { setCalendarEvents(calendar.value || []); setCalendarError(''); }
    else setCalendarError(calendar.reason?.message || 'No se pudieron cargar los cambios del calendario.');
    if (signups.status === 'fulfilled') { setRegistrations(signups.value); setRegistrationError(''); }
    else setRegistrationError(signups.reason?.message || 'No se pudieron cargar las nuevas altas.');
    if (linkOpens.status === 'fulfilled') { setPersonalLinks(linkOpens.value); setPersonalLinkError(''); }
    else setPersonalLinkError(linkOpens.reason?.message || 'No se pudieron cargar los accesos a enlaces personales.');
    if (partActivity.status === 'fulfilled') { setPartOpens(partActivity.value || []); setPartOpenError(''); }
    else setPartOpenError(partActivity.reason?.message || 'No se pudieron cargar las aperturas de partes.');
    if (pushActivity.status === 'fulfilled') { setPushActivations(pushActivity.value); setPushActivationError(''); }
    else setPushActivationError(pushActivity.reason?.message || 'No se pudieron cargar las activaciones.');
    if (deliveryActivity.status === 'fulfilled') { setPushDeliveries(deliveryActivity.value); setPushDeliveryError(''); }
    else setPushDeliveryError(deliveryActivity.reason?.message || 'No se pudieron cargar los envíos.');
  };
  useEffect(() => { load(); const timer = setInterval(load, 60_000); return () => clearInterval(timer); }, [session.token]);
  const users = (data?.users || []).filter((user) => String(user.chapa) !== '72683' && ACTIVE_PAGES.has(user.lastPage) && String(user.chapa || '').includes(filter)).slice(0, displayLimit);
  const pages = [...ACTIVE_PAGES].map((page) => (data?.pages || []).find((item) => item.page === page) || { page, views: 0, users: 0 });
  const recent = (data?.recent || []).filter((event) => String(event.chapa) !== '72683' && (event.type === 'page_visit'
    ? ACTIVE_PAGES.has(event.page) : ['login', 'register', 'app_open'].includes(event.type))).slice(0, displayLimit);
  const visibleJournalEvents = journalEvents.filter((event) => String(event.chapa) !== '72683' && String(event.chapa || '').includes(filter)).slice(0, displayLimit);
  const visibleCalendarEvents = calendarEvents.filter((event) => String(event.chapa) !== '72683' && String(event.chapa || '').includes(filter)).slice(0, displayLimit);
  const matchingRegistrations = (registrations?.registrations || []).filter((user) => String(user.chapa || '').includes(filter));
  const visiblePersonalLinks = (personalLinks?.recent || []).filter((event) => String(event.chapa || '').includes(filter));
  const recentPersonalLinkUsers = [...new Map((personalLinks?.recent || [])
    .filter((event) => new Date(event.opened_at).getTime() >= Date.now() - 24 * 60 * 60 * 1000)
    .map((event) => [String(event.chapa), event])).values()]
    .filter((event) => String(event.chapa || '').includes(filter));
  const visiblePartOpens = (partOpens || []).filter((event) => String(event.chapa || '').includes(filter)).slice(0, 10);
  const visiblePushActivations = (pushActivations?.users || []).filter((user) => String(user.chapa || '').includes(filter)).slice(0, 10);
  const personalLinkLabels = { 'donde-voy': 'Mi contratación', vacaciones: 'Vacaciones', dobles: 'Dobles y HS', jornales: 'Jornales y primas', descansos: 'Descansos', chapero: 'Chapero', 'chapero-especialidades': 'Chapero por especialidades', puertas: 'Puertas', 'jornada-contratada': 'Jornada contratada', 'situacion-trabajador': 'Jornada flexible' };
  const registrationTime = (value) => value ? new Date(value).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'medium' }) : '—';
  const time = (value) => value ? new Date(value).toLocaleString('es-ES') : '—';
  const workDay = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('es-ES') : '—';
  const action = (value) => ({ added: 'Añadido', edited: 'Editado', deleted: 'Eliminado' })[value] || value;
  const dayType = (value) => ({ REST: 'DS', FS: 'FS', WORK: 'Disponible', VA: 'VA', FM: 'FM' })[value] || value || '—';
  const dayChange = (event) => event.event_type === 'deleted' ? dayType(event.previous_day_type)
    : event.previous_day_type && event.previous_day_type !== event.day_type
      ? `${dayType(event.previous_day_type)} → ${dayType(event.day_type)}` : dayType(event.day_type);
  return <section className="manual-panel monitor-panel"><div className="section-head"><div><p className="eyebrow">Administración</p><h2>Monitor de actividad</h2></div><button onClick={load}>Actualizar</button></div>
    <p>Accesos y pantallas visitadas durante las últimas 24 horas. Los cambios de jornales y días del calendario se conservan en el registro.</p>
    {error && <p className="form-error">{error}</p>}
    <div className="monitor-numbers"><span><strong>{data?.summary?.uniqueUsers ?? '—'}</strong> usuarios</span><span><strong>{data?.summary?.activeNow ?? '—'}</strong> activos</span><span><strong>{pages.reduce((sum, page) => sum + Number(page.views || 0), 0)}</strong> pantallas vistas</span><span><strong>{data?.summary?.logins ?? '—'}</strong> accesos</span></div>
    <input aria-label="Buscar chapa en el monitor" value={filter} onChange={(event) => { setFilter(event.target.value); setRegistrationLimit(10); setPersonalLinkLimit(10); }} placeholder="Buscar chapa" inputMode="numeric" />
    <h3>Pantallas</h3><p>Visitas de las últimas 24 horas. También se muestran las pantallas sin visitas. Tus accesos de administrador y los de soporte no se contabilizan.</p><div className="monitor-pages">{pages.map((page) => <span key={page.page}>{page.page}: <strong>{data ? page.views : '—'}</strong></span>)}</div>
    <h3>Usuarios recientes</h3>
    <div className="table-wrap"><table><thead><tr><th>Chapa</th><th>Última pantalla</th><th>Visitas</th><th>Última actividad</th></tr></thead><tbody>{users.map((user) => <tr key={user.chapa}><td>{user.chapa}</td><td>{user.lastPage || '—'}</td><td>{user.views}</td><td>{time(user.lastSeen)}</td></tr>)}</tbody></table></div>
    <h3>Accesos a enlaces personales</h3>
    <p>Aperturas desde los botones de la app, registradas desde esta actualización. Fecha y hora de Madrid.</p>
    <div className="monitor-numbers"><span><strong>{personalLinks?.opens24h ?? '—'}</strong> aperturas en las últimas 24 horas</span><span><strong>{personalLinks?.users24h ?? '—'}</strong> usuarios</span></div>
    <div className="monitor-personal-link-users"><strong>Chapas de las últimas 24 horas</strong><div>{recentPersonalLinkUsers.map((event) => <span key={event.chapa}><strong>{event.chapa}</strong> · {personalLinkLabels[event.section] || event.section} · {registrationTime(event.opened_at)}</span>)}{personalLinks && recentPersonalLinkUsers.length === 0 && <span>Ninguna apertura para el filtro actual.</span>}</div></div>
    <div className="monitor-pages">{(personalLinks?.sections || []).map((item) => <span key={item.section}>{personalLinkLabels[item.section] || item.section}: <strong>{item.opens}</strong></span>)}</div>
    {personalLinkError && <p className="form-error" role="alert">{personalLinkError}</p>}
    <div className="table-wrap"><table><thead><tr><th>Fecha y hora</th><th>Chapa</th><th>Nombre</th><th>Enlace abierto</th></tr></thead><tbody>
      {visiblePersonalLinks.slice(0, personalLinkLimit).map((event) => <tr key={event.id}><td>{registrationTime(event.opened_at)}</td><td><strong>{event.chapa}</strong></td><td>{event.display_name || 'Sin nombre informado'}</td><td>{personalLinkLabels[event.section] || event.section}</td></tr>)}
    </tbody></table>{!personalLinkError && personalLinks && visiblePersonalLinks.length === 0 && <p className="monitor-empty">Todavía no hay aperturas de enlaces personales para el filtro actual.</p>}</div>
    {visiblePersonalLinks.length > personalLinkLimit && <button className="monitor-more-button" type="button" onClick={() => setPersonalLinkLimit((current) => current + 10)}>Ver más accesos<ChevronRight size={16} aria-hidden="true" /></button>}
    <h3>Partes abiertos en Mi contratación</h3>
    <p>Últimas 10 aperturas de otros usuarios, con chapa y hora. La chapa 72683 no se registra.</p>
    {partOpenError && <p className="form-error" role="alert">{partOpenError}</p>}
    <div className="table-wrap"><table><thead><tr><th>Fecha y hora</th><th>Chapa</th><th>Nombre</th><th>Parte</th><th>Jornada</th></tr></thead><tbody>
      {visiblePartOpens.map((event) => <tr key={event.id}><td>{registrationTime(event.opened_at)}</td><td><strong>{event.chapa}</strong></td><td>{event.display_name || 'Sin nombre informado'}</td><td>{event.parte}</td><td>{workDay(event.work_date)} · {event.shift}</td></tr>)}
    </tbody></table>{partOpens && !visiblePartOpens.length && <p className="monitor-empty">No hay aperturas de partes para el filtro actual.</p>}</div>
    <h3>Nuevas altas</h3>
    <p>Últimos registros de la app, aunque no hayan vuelto a entrar. Fecha y hora de Madrid.</p>
    <div className="monitor-numbers"><span><strong>{registrations?.last24h ?? '—'}</strong> altas en las últimas 24 horas</span><span><strong>{registrations?.total ?? '—'}</strong> cuentas registradas</span></div>
    {registrationError && <p className="form-error" role="alert">{registrationError}</p>}
    <div className="table-wrap"><table><thead><tr><th>Fecha y hora de registro</th><th>Chapa</th><th>Nombre</th></tr></thead><tbody>
      {matchingRegistrations.slice(0, registrationLimit).map((user) => <tr key={user.chapa}><td>{registrationTime(user.created_at)}</td><td><strong>{user.chapa}</strong></td><td>{user.display_name || 'Sin nombre informado'}</td></tr>)}
    </tbody></table>{!registrationError && registrations && matchingRegistrations.length === 0 && <p className="monitor-empty">No hay registros para el filtro actual.</p>}</div>
    {matchingRegistrations.length > registrationLimit && <button className="monitor-more-button" type="button" onClick={() => setRegistrationLimit((current) => current + 10)}>Ver más altas<ChevronRight size={16} aria-hidden="true" /></button>}
    <h3>Jornales manuales registrados</h3>
    <p>Últimos 10 movimientos. La fecha y hora indican cuándo se añadió, editó o eliminó el jornal.</p>
    {journalError && <p className="form-error" role="alert">{journalError}</p>}
    <div className="table-wrap"><table><thead><tr><th>Fecha y hora</th><th>Chapa</th><th>Acción</th><th>Día del jornal</th><th>Turno</th><th>Puesto</th><th>Grupo</th><th>Operación</th></tr></thead><tbody>
      {visibleJournalEvents.map((event) => <tr key={event.id}><td>{time(event.occurred_at)}</td><td><strong>{event.chapa}</strong></td><td>{action(event.event_type)}</td><td>{workDay(event.work_date)}</td><td>{event.shift}</td><td>{event.specialty}</td><td>{event.worker_group}</td><td>{event.operation_type === 'RECEPCION_ENTREGA' ? 'OC' : 'SP'}</td></tr>)}
    </tbody></table>{!journalError && visibleJournalEvents.length === 0 && <p className="monitor-empty">No hay movimientos de jornales manuales para el filtro actual.</p>}</div>
    <h3>Cambios en el calendario personal</h3>
    <p>Últimos 10 movimientos de DS, FS, Disponible, VA y FM, incluidos VA y FM añadidos desde Sueldómetro.</p>
    {calendarError && <p className="form-error" role="alert">{calendarError}</p>}
    <div className="table-wrap"><table><thead><tr><th>Fecha y hora</th><th>Chapa</th><th>Acción</th><th>Día</th><th>Tipo</th></tr></thead><tbody>
      {visibleCalendarEvents.map((event) => <tr key={event.id}><td>{time(event.occurred_at)}</td><td><strong>{event.chapa}</strong></td><td>{action(event.event_type)}</td><td>{workDay(event.work_date)}{event.previous_work_date && event.previous_work_date !== event.work_date ? ` · antes ${workDay(event.previous_work_date)}` : ''}</td><td>{dayChange(event)}</td></tr>)}
    </tbody></table>{!calendarError && visibleCalendarEvents.length === 0 && <p className="monitor-empty">No hay cambios de días para el filtro actual.</p>}</div>
    <h3>Actividad reciente</h3><div className="recent-list">{recent.map((event) => <div key={event.id}><strong>{event.chapa || 'Anónimo'}</strong><span>{event.type === 'page_visit' ? `Visita ${event.page}` : event.type}</span><time>{time(event.at)}</time></div>)}</div>
    <h3>Notificaciones activadas</h3>
    <p>Usuarios que tienen actualmente avisos del móvil activados. Fecha y hora de Madrid.</p>
    <div className="monitor-numbers"><span><strong>{pushActivations?.total ?? '—'}</strong> usuarios</span></div>
    {pushActivationError && <p className="form-error" role="alert">{pushActivationError}</p>}
    <div className="table-wrap"><table><thead><tr><th>Chapa</th><th>Nombre</th><th>Activadas</th><th>Dispositivos</th></tr></thead><tbody>
      {visiblePushActivations.map((user) => <tr key={user.chapa}><td><strong>{user.chapa}</strong></td><td>{user.display_name || 'Sin nombre informado'}</td><td>{registrationTime(user.activated_at)}</td><td>{user.devices}</td></tr>)}
    </tbody></table>{pushActivations && visiblePushActivations.length === 0 && <p className="monitor-empty">Ningún usuario con notificaciones activadas para el filtro actual.</p>}</div>
    <h4>Notificaciones enviadas</h4>
    <p>Cada fila registra un envío. En el móvil, los avisos próximos se agrupan en una sola tarjeta.</p>
    {pushDeliveryError && <p className="form-error" role="alert">{pushDeliveryError}</p>}
    <div className="table-wrap"><table><thead><tr><th>Fecha y hora</th><th>Chapa</th><th>Aviso</th><th>Estado</th><th>Abierta</th></tr></thead><tbody>
      {(pushDeliveries?.rows || []).filter((item) => String(item.chapa || '').includes(filter)).slice(0, 10).map((item) => <tr key={item.id}><td>{registrationTime(item.updated_at)}</td><td><strong>{item.chapa}</strong></td><td>{item.title}</td><td>{item.state === 'sent' ? 'Enviada' : item.state === 'failed' ? 'Fallida' : item.state === 'processing' ? 'En proceso' : 'Pendiente'}</td><td>{item.opened_at ? `${registrationTime(item.opened_at)} · ${item.opened_source === 'push' ? 'Aviso móvil' : 'Novedades'}` : '—'}</td></tr>)}
    </tbody></table>{pushDeliveries && !(pushDeliveries.rows || []).some((item) => String(item.chapa || '').includes(filter)) && <p className="monitor-empty">No hay envíos para el filtro actual.</p>}</div>
  </section>;
}

function JornalCard({ item, onOpen }) {
  const paidDay = item.isVacation || item.isTraining;
  const logo = paidDay ? '' : companyImage(item.empresa);
  const destination = [item.buque, item.empresa].filter((value) => value && !/^(?:--?|—)$/.test(String(value).trim())).join(' · ');
  return <article className={`production-jornal${logo ? ' has-company-logo' : ''}${item.isVacation ? ' is-vacation' : ''}${item.isTraining ? ' is-training' : ''}`} style={logo ? { '--jornal-company-logo': `url("${logo}")` } : undefined} role="button" tabIndex={0} aria-label={`Ver detalle ${paidDay ? 'del día retribuido' : 'del jornal'} del ${item.dia || item.payroll.date.slice(-2)}`} onClick={() => onOpen(item)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(item); } }}>
    <div className="portal-jornal-date"><strong>{Number(item.dia || item.payroll.date.slice(-2))}</strong><span>{paidDay ? (item.isVacation ? 'VA' : 'FM') : item.payroll.shift}</span></div>
    <div className="portal-jornal-content">
      <div className="portal-jornal-heading"><strong>{paidDay ? (item.isVacation ? 'Vacaciones' : 'Formación') : item.especialidad || 'Jornal'}</strong><strong className="portal-jornal-total">{formatEuro(item.payroll.total)}</strong></div>
      {paidDay ? <em>Día de {item.isVacation ? 'vacaciones' : 'formación'} retribuido</em> : <><em className="portal-jornal-destination">{destination}</em>{item.operacion && <em>{item.operacion}</em>}</>}
      {!paidDay && item.companyNeedsSaving && <span className="manual-jornal-company-warning">{item.empresa ? 'Empresa tomada del parte. Guárdala al editar el jornal.' : 'Indica la empresa al editar el jornal para mostrar su logo.'}</span>}
      <div className="portal-jornal-breakdown">
        <span>{paidDay ? 'Importe' : 'Base'} <b>{formatEuro(item.payroll.base)}</b></span>
        {!paidDay && item.payroll.complement > 0 && <span>Complemento <b>{formatEuro(item.payroll.complement)}</b></span>}
        {!paidDay && item.payroll.continuousDoubleMeal > 0 && <span>Manutención doble · {item.payroll.continuousDoubleMealHours} <b>{formatEuro(item.payroll.continuousDoubleMeal)}</b></span>}
        {!paidDay && item.payroll.relayHour > 0 && <span>Hora de relevo <b>{formatEuro(item.payroll.relayHour)}</b></span>}
        {!paidDay && item.payroll.remate > 0 && <span>Remate · {item.payroll.remateHours} {item.payroll.remateHours === 1 ? 'hora' : 'horas'} <b>{formatEuro(item.payroll.remate)}</b></span>}
        {!paidDay && item.payroll.operationType !== 'RECEPCION_ENTREGA' && <span className={item.payroll.primaPending ? 'is-pending' : 'is-prima'}>Prima <b>{item.payroll.primaPending ? 'Pendiente' : formatEuro(item.payroll.prima || 0)}</b></span>}
      </div>
    </div>
    <ChevronRight className="portal-jornal-chevron" size={19} />
  </article>;
}

function JornalDetail({ item, busy, relayBusy, relayError, onRelayChange, onClose, onEdit, onRemove, onPremium, onEditPaid, onRemovePaid }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  const paidDay = item.isVacation || item.isTraining;
  const action = (callback) => { onClose(); callback(item); };
  return <div className="manual-detail-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="manual-detail-modal" role="dialog" aria-modal="true" aria-label={`Detalle del ${paidDay ? 'día' : 'jornal'} ${item.payroll.date}`}>
    <header><div><small>{new Date(`${item.payroll.date}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })} · {item.payroll.shift}</small><h2>{paidDay ? (item.isVacation ? 'Vacaciones' : 'Formación') : item.especialidad || 'Jornal'}</h2></div><button type="button" onClick={onClose} aria-label="Cerrar"><X size={21} /></button></header>
    {!paidDay && <p>{[item.buque, item.empresa, item.operacion].filter(Boolean).join(' · ')}</p>}
    <div className="manual-detail-values"><span>Base <b>{formatEuro(item.payroll.base)}</b></span>{!paidDay && item.payroll.complement > 0 && <span>Complemento <b>{formatEuro(item.payroll.complement)}</b></span>}{!paidDay && <span>Prima <b>{item.payroll.primaPending ? 'Pendiente' : formatEuro(item.payroll.prima || 0)}</b></span>}{!paidDay && item.payroll.continuousDoubleMeal > 0 && <span>Manutención doble · {item.payroll.continuousDoubleMealHours} <b>{formatEuro(item.payroll.continuousDoubleMeal)}</b></span>}{!paidDay && item.payroll.relayHour > 0 && <span>Hora de relevo <b>{formatEuro(item.payroll.relayHour)}</b></span>}{!paidDay && item.payroll.remate > 0 && <span>Remate <b>{formatEuro(item.payroll.remate)}</b></span>}<span>Total <b>{formatEuro(item.payroll.total)}</b></span></div>
    {!paidDay && item.payroll.relayHourEligible && <label className={`manual-relay-hour${item.payroll.relayHourEnabled ? ' is-enabled' : ''}`}><input type="checkbox" checked={item.payroll.relayHourEnabled} disabled={busy || relayBusy} onChange={(event) => onRelayChange(item, event.target.checked)} /><span>Hora de relevo<small>{item.payroll.relayHourRateKey === 'FESTIVO' ? 'Festiva' : 'Laborable'} · +{formatEuro(item.payroll.relayHourRate)}</small></span></label>}
    {relayError && <p className="manual-relay-error" role="alert">{relayError}</p>}
    {!paidDay && (item.source === 'manual' ? item.manualPart : item.parte) && <p>Parte {item.source === 'manual' ? item.manualPart : item.parte}</p>}{item.notes && <p>{item.notes}</p>}
    <div className="manual-detail-actions">{item.source === 'manual' && <><button type="button" disabled={busy} onClick={() => action(onEdit)}>Editar jornal</button><button type="button" disabled={busy} onClick={() => action(onPremium)}>Editar prima</button><button type="button" className="is-danger" disabled={busy} onClick={() => action(() => onRemove(item.id))}>Eliminar jornal</button></>}{item.source === 'historico' && <button type="button" disabled={busy} onClick={() => action(onPremium)}>Editar prima</button>}{item.source === 'manual_paid_day' && <><button type="button" disabled={busy} onClick={() => action(onEditPaid)}>Editar día</button><button type="button" disabled={busy} onClick={() => action(() => onRemovePaid(item.id))}>Eliminar día</button></>}</div>
  </section></div>;
}

function QuickPremiumModal({ value, onChange, onClose, onSave, busy, error }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);
  return <div className="manual-detail-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="manual-detail-modal manual-quick-premium" role="dialog" aria-modal="true" aria-labelledby="quick-premium-title">
    <header><h2 id="quick-premium-title">Editar prima</h2><button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={21} /></button></header>
    <form onSubmit={onSave}><label htmlFor="quick-premium-amount">Importe de la prima (€)</label><input id="quick-premium-amount" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} placeholder="0,00" autoFocus required />
      {error && <p className="manual-quick-premium-error" role="alert">{error}</p>}
      <div className="manual-quick-premium-actions"><button type="button" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar prima'}</button></div>
    </form>
  </section></div>;
}

function ManualEditorDialog({ children, onClose, busy, label, wide = false }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);
  return <div className="manual-detail-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className={`manual-jornal-dialog${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={label}>{children}</div>
  </div>;
}

function ExchangeNotifications({ rows, onOpen, onMarkAll, pushState, pushError, onEnablePush, onDisablePush }) {
  const [testMessage, setTestMessage] = useState('');
  return <section className="manual-panel exchange-notifications"><div className="section-head"><div><p className="eyebrow">ACTIVIDAD</p><h2>Actividad reciente</h2></div>
    {rows.some((item) => !item.readAt) && <button type="button" onClick={onMarkAll}>Marcar todo leído</button>}</div>
    {pushState !== 'enabled' && pushState !== 'unsupported' && <div className="notification-push-prompt"><span>Recibe avisos también cuando cierres la app.</span><button type="button" onClick={onEnablePush}>Activar notificaciones</button>{pushState === 'denied' && <small>Permite las notificaciones para App CPE en los ajustes del navegador.</small>}{pushError && <small role="alert">No se pudieron activar: {pushError}</small>}</div>}
    {pushState === 'enabled' && <div className="notification-push-prompt"><span>Avisos activados en este dispositivo.</span><button type="button" onClick={() => testDeviceNotification().then(() => setTestMessage('Prueba enviada. Si no aparece en el móvil, revisa los permisos de notificaciones de App CPE y Chrome en Android.')).catch((error) => setTestMessage(error?.message || 'No se pudo mostrar la prueba.'))}>Probar aviso</button><button type="button" className="notification-push-disable" onClick={onDisablePush}>Desactivar notificaciones</button>{testMessage && <small role="status">{testMessage}</small>}{pushError && <small role="alert">{pushError}</small>}</div>}
    <div className="exchange-notification-list">{rows.map((item) => <button type="button" key={item.id}
      className={item.readAt ? 'is-read' : 'is-unread'} onClick={() => onOpen(item)}>
      <span className="exchange-notification-icon"><Bell size={19} aria-hidden="true" /></span>
      <span className="exchange-notification-copy"><strong>{item.title}</strong><span>{item.body}</span><small>{new Date(item.createdAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</small></span>
      <ChevronRight size={19} className="exchange-notification-arrow" aria-hidden="true" />
    </button>)}</div>
  </section>;
}

function DeleteAccountDialog({ session, onClose, onDeleted }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    if (confirmation !== 'ELIMINAR' || !password || busy) return;
    setBusy(true);
    setError('');
    try {
      await rpc('app_cpe_delete_account', {
        p_token: session.token,
        p_current_password: password,
        p_confirmation: confirmation
      });
      onDeleted();
    } catch (cause) {
      setError(cause?.message || 'No se pudo eliminar la cuenta.');
      setBusy(false);
    }
  };
  return <div className="account-delete-backdrop" onClick={() => { if (!busy) onClose(); }}>
    <section className="account-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="account-delete-title" onClick={(event) => event.stopPropagation()}>
      <div className="account-delete-heading"><Trash2 size={25} aria-hidden="true" /><h2 id="account-delete-title">Eliminar cuenta</h2><button type="button" aria-label="Cerrar" disabled={busy} onClick={onClose}><X size={20} /></button></div>
      <p>Se borrarán definitivamente tu cuenta, jornales, primas, días guardados, enlaces del portal, ofertas, conversaciones y notificaciones. Esta acción no se puede deshacer.</p>
      <form onSubmit={submit}>
        <label>Contraseña de App CPE<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <label>Escribe ELIMINAR para confirmar<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="account-delete-actions"><button type="button" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" className="account-delete-confirm" disabled={busy || !password || confirmation !== 'ELIMINAR'}>{busy ? 'Eliminando…' : 'Eliminar mi cuenta'}</button></div>
      </form>
    </section>
  </div>;
}

function ExchangeSection({ session, section, onSectionChange, onPaidDaysChange }) {
  return <div className="exchange-area"><div className="exchange-type-switch" role="tablist" aria-label="Tipo de intercambio">
    <button type="button" role="tab" aria-selected={section === 'descansos'} className={section === 'descansos' ? 'is-active' : ''} onClick={() => onSectionChange('descansos')}>Descansos</button>
    <button type="button" role="tab" aria-selected={section === 'vacaciones'} className={section === 'vacaciones' ? 'is-active' : ''} onClick={() => onSectionChange('vacaciones')}>Vacaciones</button>
  </div>{section === 'vacaciones' ? <VacationExchangePanel session={session} onPaidDaysChange={onPaidDaysChange} /> : <RestExchangePanel session={session} onPaidDaysChange={onPaidDaysChange} />}</div>;
}

function Salary({ session, onSession }) {
  const [snapshot, setSnapshot] = useState(null);
  const [manualRows, setManualRows] = useState([]);
  const [paidRows, setPaidRows] = useState([]);
  const [premiums, setPremiums] = useState({});
  const [sharedPremiums, setSharedPremiums] = useState({});
  const [relayHours, setRelayHours] = useState({});
  const [savingRelayHourKey, setSavingRelayHourKey] = useState('');
  const [relayHourError, setRelayHourError] = useState('');
  const [remateHours, setRemateHours] = useState({});
  const [config, setConfig] = useState(null);
  const [month, setMonth] = useState('');
  const [period, setPeriod] = useState(() => new Date().getDate() <= 15 ? 'first' : 'second');
  const [form, setForm] = useState(blank);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [paidForm, setPaidForm] = useState({ id: null, work_date: today(), concept_type: 'VA' });
  const [showPaidForm, setShowPaidForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const isAdmin = session.chapa === '72683';
  const contractingEnabled = CONTRACTING_ENABLED;
  const [tab, setTab] = useState(viewFromHash);
  const [notificationRoute, setNotificationRoute] = useState(() => window.location.hash);
  const [notifications, setNotifications] = useState([]);
  const handledNotification = useRef('');
  const [personalLinkAvailable, setPersonalLinkAvailable] = useState(false);
  const [doblesLinkAvailable, setDoblesLinkAvailable] = useState(false);
  const [vacationLinkAvailable, setVacationLinkAvailable] = useState(false);
  const [portalLinkStatus, setPortalLinkStatus] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [premiumEditor, setPremiumEditor] = useState(null);
  const [premiumError, setPremiumError] = useState('');
  const [irpf, setIrpf] = useState(Number(session.irpfRate) || 0);

  const refreshSharedPremiums = async (oldData, rows, rateData, premiumData, relayData, remateData, paidDays) => {
    const requests = buildManualSalaryMonths(oldData, rows || [], rateData, premiumData || {}, relayData || {}, remateData || {}, paidDays || [])
      .flatMap((entry) => entry.items).map(sharedPremiumRequest).filter(Boolean);
    const batches = [];
    for (let i = 0; i < requests.length; i += 250) batches.push(requests.slice(i, i + 250));
    const responses = await Promise.all(batches.map((items) =>
      rpc('app_cpe_get_my_shared_manual_premiums', { p_token: session.token, p_requests: items })));
    setSharedPremiums(Object.fromEntries(responses.flat().map((row) => [row.key, Number(row.amount)])));
  };

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [oldData, newRows, paidDays, premiumData, rateData, relayData, remateData, pilot, pilotPremiums, upcomingPreview] = await Promise.all([
        rpc('app_cpe_get_saved_salary_history', { p_token: session.token }),
        rpc('app_cpe_list_manual_jornales', { p_token: session.token }),
        rpc('app_cpe_list_manual_paid_days', { p_token: session.token }),
        getUserManualPremiums({ token: session.token }), loadPayrollConfig(),
        getUserRelayHours({ token: session.token }), getUserRemateHours({ token: session.token }),
        loadNorayPilotSnapshot(session.chapa, session.token).catch(() => null),
        loadNorayPilotPremiums(session.chapa, session.token).catch(() => null),
        rpc('app_cpe_get_portal_preview_snapshot', { p_token: session.token, p_channel: 'upcoming-contracts-72683' }).catch(() => null)
      ]);
      const mergedSalary = mergeNorayPilotSalary(oldData, newRows || [], pilot, pilotPremiums);
      const upcomingReading = upcomingPreview?.payload?.upcomingAssignments;
      const upcomingRows = String(upcomingPreview?.chapa) === String(session.chapa)
        && String(upcomingReading?.chapa) === String(session.chapa)
        && Array.isArray(upcomingReading?.rows) ? upcomingReading.rows : [];
      const salaryData = { ...mergedSalary, payload: { ...mergedSalary?.payload, upcomingAssignments: upcomingRows } };
      setSnapshot(salaryData); setManualRows(newRows || []); setPaidRows(paidDays || []); setPremiums(premiumData || {}); setConfig(rateData); setRelayHours(relayData || {}); setRemateHours(remateData || {});
      await refreshSharedPremiums(salaryData, newRows, rateData, premiumData, relayData, remateData, paidDays).catch(() => {});
    } catch (reason) { setError(reason.message || 'No se pudieron cargar los datos.'); }
    finally { setLoading(false); }
  };
  const refreshPaidDays = async (workDate) => {
    try {
      const rows = await rpc('app_cpe_list_manual_paid_days', { p_token: session.token });
      setPaidRows(rows || []);
      setError('');
      if (workDate) {
        setMonth(workDate.slice(0, 7));
        setPeriod('month');
      }
    } catch (reason) {
      setError(reason.message || 'No se pudieron actualizar los días VA y FM en Sueldómetro.');
    }
  };
  useEffect(() => {
    if (!config) return undefined;
    const timer = window.setInterval(() => {
      refreshSharedPremiums(snapshot, manualRows, config, premiums, relayHours, remateHours, paidRows).catch(() => {});
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [session.token, snapshot, manualRows, config, premiums, relayHours, remateHours, paidRows]);
  useEffect(() => { load(); if (!session.supportAccess && String(session.chapa) !== '72683') trackUsageEvent({ eventType: 'app_open', chapa: session.chapa }).catch(() => {}); }, [session.token]);
  useEffect(() => {
    let active = true;
    const refresh = () => supabase?.rpc('app_cpe_portal_link_request_status', { p_token: session.token })
      .then(({ data, error }) => { if (active && !error) setPortalLinkStatus(data); });
    setPortalLinkStatus(null);
    refresh();
    window.addEventListener('app-cpe-portal-link-updated', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('app-cpe-portal-link-updated', refresh); };
  }, [session.token]);
  const [pushState, setPushState] = useState('idle');
  const [pushError, setPushError] = useState('');
  const [pushPromptDismissedAt, setPushPromptDismissedAt] = useState(() => Number(localStorage.getItem(`app-cpe-push-prompt-dismissed-${session.chapa}`) || 0));
  const [pushPromptDone, setPushPromptDone] = useState(false);
  const enablePush = () => enablePushNotifications(session.token).then((ok) => {
    setPushState(ok ? 'enabled' : Notification.permission === 'denied' ? 'denied' : 'idle');
    setPushError(ok ? '' : 'Comprueba los permisos del navegador.');
    if (ok) setPushPromptDone(true);
  }).catch((error) => { setPushState('idle'); setPushError(error?.message || 'Error de conexión'); });
  const dismissPushPrompt = () => {
    const now = Date.now();
    localStorage.setItem(`app-cpe-push-prompt-dismissed-${session.chapa}`, String(now));
    setPushPromptDismissedAt(now);
  };
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  useEffect(() => {
    if (!('Notification' in window) || !('PushManager' in window)) { setPushState('unsupported'); return; }
    if (Notification.permission === 'denied') { setPushState('denied'); return; }
    if (Notification.permission !== 'granted') return;
    let active = true;
    const refresh = () => refreshPushSubscription(session.token)
      .then((ok) => { if (active) { setPushState(ok ? 'enabled' : 'idle'); if (ok) setPushError(''); } })
      .catch((error) => { if (active) { setPushState('idle'); setPushError(error?.message || 'Error de conexión'); } });
    refresh();
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(onVisibility, 5 * 60_000);
    return () => { active = false; document.removeEventListener('visibilitychange', onVisibility); window.clearInterval(timer); };
  }, [session.token]);
  useEffect(() => {
    if (!session.token) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      Promise.all([loadNorayPilotSnapshot(session.chapa, session.token),
        loadNorayPilotPremiums(session.chapa, session.token)]).then(([pilot, pilotPremiums]) => {
        if (pilot) setSnapshot((current) => mergeNorayPilotSalary(current, manualRows, pilot, pilotPremiums));
      }).catch(() => {});
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [session.chapa, session.token, manualRows]);
  useEffect(() => {
    let active = true;
    refreshCurrentUser({ token: session.token }).then((current) => {
      if (!active || !current?.token) return;
      const next = { ...session, ...current };
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      onSession(next);
    }).catch(() => {});
    return () => { active = false; };
  }, [session.token]);
  useEffect(() => {
    const followHash = () => {
      const page = viewFromHash();
      setTab(page);
      setNotificationRoute(window.location.hash);
    };
    followHash();
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, []);
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [tab]);
  useEffect(() => { if (!session.supportAccess && String(session.chapa) !== '72683' && ACTIVE_PAGES.has(tab)) trackPageVisit({ token: session.token, page: tab }).catch(() => {}); }, [session.token, session.supportAccess, session.chapa, tab]);
  useEffect(() => {
    if (session.supportAccess) return undefined;
    const touch = () => touchDirectPresence({ token: session.token }).catch(() => {});
    touch();
    const timer = window.setInterval(touch, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [session.token, session.supportAccess]);
  useEffect(() => {
    let active = true;
    const refresh = () => getUserNotifications({ token: session.token, limit: 100 })
      .then((data) => { if (active) setNotifications((data.rows || []).filter((row) => ACTIVE_NOTIFICATION_TYPES.has(row.eventType)
        && (!['new_journal', 'new_premium', 'journal_updated', 'premium_updated'].includes(row.eventType) || new Date(row.createdAt).getTime() >= Date.parse('2026-10-27T00:00:00Z')))); })
      .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session.token]);
  useEffect(() => {
    rpc('app_cpe_has_manual_noray_section_link', { p_token: session.token, p_section: 'dobles' })
      .then((available) => setDoblesLinkAvailable(available === true)).catch(() => setDoblesLinkAvailable(false));
    rpc('app_cpe_has_manual_noray_section_link', { p_token: session.token, p_section: 'vacaciones' })
      .then((available) => setVacationLinkAvailable(available === true)).catch(() => setVacationLinkAvailable(false));
  }, [session.token]);
  useEffect(() => {
    Promise.allSettled([
      rpc('app_cpe_has_manual_donde_voy_link', { p_token: session.token }),
      canOpenNorayLinks({ token: session.token })
    ]).then(([manual, legacy]) => setPersonalLinkAvailable(
      (manual.status === 'fulfilled' && manual.value === true) || (legacy.status === 'fulfilled' && legacy.value === true)
    ));
  }, [session.token]);

  const navigate = (next) => { const page = (next === 'monitor' && isAdmin) || next === 'novedades' || ACTIVE_PAGES.has(next) ? next : 'sueldometro'; window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); setTab(page); setMenuOpen(false); if (page !== 'monitor') window.location.hash = `#/${page}`; };
  const openNotification = (item, source = 'app') => {
    rpc('app_cpe_record_notification_open', { p_token: session.token, p_notification_id: item.id, p_source: source }).catch(() => {});
    if (!item.readAt) {
      setNotifications((rows) => rows.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row));
      markUserNotificationsRead({ token: session.token, notificationId: item.id }).catch(() => {});
    }
    const section = item.eventType?.startsWith('vacation_') ? 'vacaciones' : 'descansos';
    if (item.eventType === 'new_journal' && /^\d{4}-\d{2}-\d{2}$/.test(String(item.metadata?.date || ''))
      && /^\d{2}-\d{2}$/.test(String(item.metadata?.shift || '')) && /^\d+$/.test(String(item.metadata?.part || ''))
      && item.metadata.date >= today()) {
      window.location.hash = `#/contratacion/parte/${item.metadata.date}/${item.metadata.shift}/${item.metadata.part}`;
      setTab('contratacion');
      return;
    }
    if (['new_journal', 'new_premium', 'journal_updated', 'premium_updated'].includes(item.eventType)) { navigate('sueldometro'); return; }
    if (item.eventType === 'direct_message' && item.metadata?.conversationId) {
      window.location.hash = directConversationHash(item.metadata.conversationId);
      setTab('conversaciones');
    } else if (item.metadata?.proposalId) {
      window.location.hash = conversationHash(section === 'vacaciones' ? 'vacation' : 'rest', item.metadata.proposalId);
      setTab('conversaciones');
    } else if (item.metadata?.offerId) {
      window.location.hash = hashForExchangeOffer(section, item.metadata.offerId);
      setTab(section);
    } else navigate(section);
  };
  useEffect(() => {
    const group = window.location.hash.match(/^#\/novedades\?source=push&ids=([0-9a-f,-]+)$/i)?.[1];
    if (group) {
      if (tab !== 'novedades' || handledNotification.current === group) return;
      handledNotification.current = group;
      for (const id of group.split(',').filter((value) => /^[0-9a-f-]{36}$/i.test(value))) {
        rpc('app_cpe_record_notification_open', { p_token: session.token, p_notification_id: id, p_source: 'push' }).catch(() => {});
      }
      return;
    }
    const id = window.location.hash.match(/^#\/novedades\/([0-9a-f-]{36})(?:\?source=push)?$/i)?.[1];
    if (!id) { handledNotification.current = ''; return; }
    if (tab !== 'novedades' || handledNotification.current === id) return;
    const item = notifications.find((row) => row.id === id);
    if (!item) return;
    handledNotification.current = id;
    openNotification(item, window.location.hash.endsWith('?source=push') ? 'push' : 'app');
  }, [notifications, tab, notificationRoute]);

  const months = useMemo(() => buildManualSalaryMonths(snapshot, manualRows, config, premiums, relayHours, remateHours, paidRows, sharedPremiums), [snapshot, manualRows, config, premiums, relayHours, remateHours, paidRows, sharedPremiums]);
  const currentMonthKey = today().slice(0, 7);
  const selectedMonthKey = month || currentMonthKey;
  const chosen = months.find((item) => item.key === selectedMonthKey) || {
    key: selectedMonthKey,
    label: new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(Number(selectedMonthKey.slice(0, 4)), Number(selectedMonthKey.slice(5, 7)) - 1, 1)),
    items: [], total: 0
  };
  const monthChoices = months.some((item) => item.key === chosen.key) ? months : [chosen, ...months];
  const selected = salaryPeriod(chosen?.items, period);
  const selectedDetailItem = selectedDetail && (chosen.items.find((item) => item.source === selectedDetail.source
    && (item.id != null ? item.id === selectedDetail.id : item.payroll.manualPremiumKey === selectedDetail.payroll.manualPremiumKey)) || selectedDetail);
  const formEstimate = useMemo(() => {
    if (!form.work_date || !form.specialty) return null;
    const [, monthNumber, day] = form.work_date.split('-');
    const raw = { dia: Number(day), jornada: form.shift, especialidad: form.specialty, payrollGroup: form.worker_group,
      operacion: form.operation_type === 'RECEPCION_ENTREGA' ? 'RECEPCION Y ENTREGA' : 'ESTIBA', parte: 'MANUAL-PREVIA' };
    const calculated = enrichJornales([raw], [], `${monthNumber}/${form.work_date.slice(0, 4)}`, config)[0]?.payroll;
    if (!calculated) return null;
    const premium = euroInput(form.premium);
    const preview = { ...raw, payroll: { ...calculated, total: Number((calculated.total + (Number.isFinite(premium) ? premium : 0)).toFixed(2)) } };
    const companions = months.find((entry) => entry.key === form.work_date.slice(0, 7))?.items
      .filter((item) => !(form.id != null && item.source === 'manual' && item.id === form.id)) || [];
    return reconcileContinuousDoubleMeals([...companions, preview]).at(-1).payroll;
  }, [form, config, months]);

  async function save(event) {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      const premium = euroInput(form.premium);
      if (!Number.isFinite(premium) || premium < 0) throw new Error('Introduce una prima válida.');
      if (!String(form.company || '').trim()) throw new Error('Selecciona la empresa o terminal.');
      const saved = await rpc('app_cpe_save_manual_jornal', { p_token: session.token, p_id: form.id,
        p_work_date: form.work_date, p_shift: form.shift, p_specialty: form.specialty.trim(),
        p_worker_group: form.worker_group, p_operation_type: form.operation_type, p_premium: premium,
        p_notes: packManualNotes({ ...form, premiumKnown: form.premium !== '' }) });
      setManualRows((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      setMonth(saved.work_date.slice(0, 7)); setShowForm(false); setForm(blank()); setNotice('Jornal guardado.');
      await load();
    } catch (reason) { setError(reason.message || 'No se pudo guardar el jornal.'); }
    finally { setBusy(false); }
  }
  async function importPastedJornales(parsed, previewPlan) {
    setBusy(true); setError(''); setNotice('');
    let savedCount = 0;
    try {
      const [latestSnapshot, latestRows, latestPremiums] = await Promise.all([
        rpc('app_cpe_get_saved_salary_history', { p_token: session.token }),
        rpc('app_cpe_list_manual_jornales', { p_token: session.token }),
        getUserManualPremiums({ token: session.token })
      ]);
      const latestItems = buildManualSalaryMonths(latestSnapshot, latestRows || [], config, latestPremiums, relayHours, remateHours, paidRows)
        .flatMap((entry) => entry.items);
      const latestPlan = planPortalJornalesImport(parsed, latestItems, latestRows || []);
      const signature = (plan) => plan.actions.map(({ kind, row, original, item }) =>
        `${kind}|${row.work_date}|${row.part}|${row.shift}|${original?.id || item?.payroll?.manualPremiumKey || ''}`).join('\n');
      if (latestPlan.conflicts.length || signature(latestPlan) !== signature(previewPlan)) {
        setSnapshot(latestSnapshot); setManualRows(latestRows || []); setPremiums(latestPremiums || {});
        throw new Error('Tus jornales han cambiado desde la vista previa. Revísala y vuelve a pulsar Importar.');
      }
      for (const action of latestPlan.actions) {
        const { row } = action;
        if (action.kind === 'premium_historic') {
          await setUserManualPremium({ token: session.token, jornalKey: action.item.payroll.manualPremiumKey,
            amount: row.premium, portalAmount: action.item.payroll.portalPrima });
        } else {
          const original = action.original;
          const details = original ? unpackManualNotes(original.notes) : null;
          const notes = original
            ? details.source === 'portal_paste' ? packManualNotes({ ...details, premiumKnown: true }) : original.notes
            : packManualNotes({ company: row.company, vessel: row.vessel, part: row.part,
              source: 'portal_paste', portalType: row.portalType, operation: row.operation, premiumKnown: row.premium !== null });
          await rpc('app_cpe_save_manual_jornal', {
            p_token: session.token, p_id: original?.id || null,
            p_work_date: original?.work_date || row.work_date, p_shift: original?.shift || row.shift,
            p_specialty: original?.specialty || row.specialty, p_worker_group: original?.worker_group || row.worker_group,
            p_operation_type: original?.operation_type || row.operation_type,
            p_premium: row.premium ?? 0, p_notes: notes
          });
        }
        savedCount++;
      }
      setMonth(parsed.monthKey); setPeriod('month'); setShowImport(false);
      const changes = [latestPlan.newCount && `${latestPlan.newCount} ${latestPlan.newCount === 1 ? 'jornal importado' : 'jornales importados'}`,
        latestPlan.premiumUpdates && `${latestPlan.premiumUpdates} ${latestPlan.premiumUpdates === 1 ? 'prima actualizada' : 'primas actualizadas'}`].filter(Boolean);
      setNotice(`${changes.join(' · ')}.`);
    } catch (reason) {
      if (savedCount) throw new Error(`${savedCount} registros guardados antes del error. Los ya guardados no se duplicarán al reintentar. ${reason.message}`);
      throw reason;
    } finally {
      if (savedCount) await load();
      setBusy(false);
    }
  }
  async function remove(id) {
    if (!window.confirm('¿Eliminar este jornal manual?')) return;
    setBusy(true); setError('');
    try { await rpc('app_cpe_delete_manual_jornal', { p_token: session.token, p_id: id }); setManualRows((rows) => rows.filter((row) => row.id !== id)); setNotice('Jornal eliminado.'); }
    catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  async function savePaidDay(event) {
    event.preventDefault(); setError(''); setNotice('');
    const existing = months.flatMap((entry) => entry.items).find((item) =>
      (item.isVacation || item.isTraining) && item.payroll.date === paidForm.work_date && item.id !== paidForm.id
    );
    if (existing) { setError('Ya existe un día VA o FM registrado en esa fecha.'); return; }
    setBusy(true);
    try {
      const saved = await rpc('app_cpe_save_manual_paid_day', { p_token: session.token, p_id: paidForm.id,
        p_work_date: paidForm.work_date, p_concept_type: paidForm.concept_type });
      setPaidRows((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      setMonth(saved.work_date.slice(0, 7)); setPeriod(Number(saved.work_date.slice(-2)) <= 15 ? 'first' : 'second');
      setShowPaidForm(false); setPaidForm({ id: null, work_date: today(), concept_type: 'VA' });
      setNotice(`${saved.concept_type} guardado.`);
    } catch (reason) { setError(reason.message || 'No se pudo guardar el día.'); }
    finally { setBusy(false); }
  }
  async function removePaidDay(id) {
    if (!window.confirm('¿Eliminar este día VA o FM manual?')) return;
    setBusy(true); setError('');
    try {
      await rpc('app_cpe_delete_manual_paid_day', { p_token: session.token, p_id: id });
      setPaidRows((rows) => rows.filter((row) => row.id !== id)); setNotice('Día eliminado.');
    } catch (reason) { setError(reason.message || 'No se pudo eliminar el día.'); }
    finally { setBusy(false); }
  }
  function editPremium(item) {
    setPremiumError('');
    setPremiumEditor({ item, value: item.payroll.primaPending ? '' : String(item.payroll.prima ?? 0) });
  }
  async function savePremium(event) {
    event.preventDefault();
    if (!premiumEditor) return;
    const amount = euroInput(premiumEditor.value);
    if (!Number.isFinite(amount) || amount < 0) { setPremiumError('Introduce un importe válido.'); return; }
    setBusy(true); setPremiumError(''); setError('');
    try {
      if (premiumEditor.item.source === 'manual') {
        const row = manualRows.find((entry) => entry.id === premiumEditor.item.id);
        if (!row) throw new Error('No se encontró el jornal. Actualiza el historial y vuelve a intentarlo.');
        const saved = await rpc('app_cpe_save_manual_jornal', { p_token: session.token, p_id: row.id,
          p_work_date: row.work_date, p_shift: row.shift, p_specialty: row.specialty,
          p_worker_group: row.worker_group, p_operation_type: row.operation_type, p_premium: amount,
          p_notes: packManualNotes({ ...unpackManualNotes(row.notes), premiumKnown: true }) });
        setManualRows((rows) => rows.map((entry) => entry.id === saved.id ? saved : entry));
      } else {
        await setUserManualPremium({ token: session.token, jornalKey: premiumEditor.item.payroll.manualPremiumKey,
          amount, portalAmount: premiumEditor.item.payroll.portalPrima });
        setPremiums(await getUserManualPremiums({ token: session.token }));
      }
      setPremiumEditor(null); setNotice('Prima guardada.');
      await load();
    } catch (reason) { setPremiumError(reason.message || 'No se pudo guardar la prima.'); }
    finally { setBusy(false); }
  }
  async function toggleRelayHour(item, enabled) {
    const jornalKey = item.payroll?.relayHourKey;
    if (!jornalKey || !item.payroll.relayHourEligible || savingRelayHourKey) return;
    setRelayHourError(''); setSavingRelayHourKey(jornalKey);
    setRelayHours((current) => ({ ...current, [jornalKey]: enabled }));
    try { await setUserRelayHour({ token: session.token, jornalKey, enabled }); }
    catch (reason) {
      setRelayHours((current) => ({ ...current, [jornalKey]: !enabled }));
      setRelayHourError(reason.message || 'No se pudo guardar la hora de relevo.');
    } finally { setSavingRelayHourKey(''); }
  }
  async function saveIrpf(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await updateUserIrpf({ token: session.token, irpfRate: irpf }); const next = { ...session, ...result, irpfRate: irpf }; localStorage.setItem(SESSION_KEY, JSON.stringify(next)); onSession(next); setNotice('IRPF guardado.'); }
    catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  const edit = (item) => { const row = manualRows.find((entry) => entry.id === item.id); if (!row) return; setError(''); setForm({ ...row, ...unpackManualNotes(row.notes), premium: String(row.premium) }); setShowForm(true); };
  const editPaidDay = (item) => { setError(''); setPaidForm({ id: item.id, work_date: item.payroll.date, concept_type: item.isVacation ? 'VA' : 'FM' }); setShowPaidForm(true); setShowForm(false); };
  const unreadCount = notifications.filter((row) => !row.readAt).length;
  const selectedCompany = companySelectValue(form.company);

  const jornalEditor = <section className="manual-panel editor manual-editor-card manual-jornal-editor"><div className="section-head"><h2>{form.id ? 'Editar jornal' : 'Nuevo jornal'}</h2><button type="button" disabled={busy} onClick={() => setShowForm(false)}>Cerrar</button></div><form onSubmit={save}>{error && <p className="form-error manual-editor-error" role="alert">{error}</p>}
      <label>Fecha<input type="date" value={form.work_date} onChange={(event) => setForm({ ...form, work_date: event.target.value })} required /></label>
      <label>Turno<select value={form.shift} onChange={(event) => setForm({ ...form, shift: event.target.value })}>{['02-08','06-12','08-14','14-20','18-00','19-01','20-02'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Grupo<select value={form.worker_group} onChange={(event) => { const worker_group = event.target.value; setForm({ ...form, worker_group, specialty: optionsForGroup(worker_group)[0] }); }}>{['I','II','III','IV'].map((value) => <option key={value} value={value}>Grupo {value}</option>)}</select></label>
      <label>Puesto / especialidad<select value={form.specialty} onChange={(event) => setForm({ ...form, specialty: event.target.value })} required>{optionsForGroup(form.worker_group, form.specialty).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Tipo de operación<select value={form.operation_type} onChange={(event) => setForm({ ...form, operation_type: event.target.value })}><option value="ESTIBA">Servicio público (SP)</option><option value="RECEPCION_ENTREGA">Operaciones complementarias (OC)</option></select></label>
      <label>Empresa o terminal<select value={selectedCompany} onChange={(event) => setForm({ ...form, company: event.target.value })} required><option value="">Selecciona una empresa</option>{form.company && selectedCompany === form.company && !['CSP','APM','MSC','VTEU','ERH','BALEARIA','TRASMED','CPE'].includes(form.company) && <option value={form.company}>{form.company}</option>}<option value="CSP">CSP</option><option value="APM">APM</option><option value="MSC">MSC</option><option value="VTEU">VTEU</option><option value="ERH">ERH</option><option value="BALEARIA">Baleària</option><option value="TRASMED">Trasmed</option><option value="CPE">CPE</option></select></label>
      <label>Buque (opcional)<input value={form.vessel} onChange={(event) => setForm({ ...form, vessel: event.target.value })} maxLength="100" /></label>
      <label>Prima (€)<input inputMode="decimal" value={form.premium} onChange={(event) => setForm({ ...form, premium: event.target.value })} placeholder="Pendiente" /></label>
      <label className="wide">N.º de parte (opcional)<input value={form.part} onChange={(event) => setForm({ ...form, part: event.target.value })} inputMode="numeric" pattern="[0-9]*" maxLength="12" placeholder="Número de parte" /></label>
      {formEstimate && <div className="form-estimate"><span>Tarifa del grupo {form.worker_group}</span><strong>{formatEuro(formEstimate.base)}</strong><span>Complemento del puesto</span><strong>{formatEuro(formEstimate.complement)}</strong><span>Prima introducida</span><strong>{formatEuro(euroInput(form.premium))}</strong><span>Total del jornal</span><strong>{formatEuro(formEstimate.total)}</strong></div>}
      <div className="form-actions"><button type="button" disabled={busy} onClick={() => setShowForm(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar jornal'}</button></div>
    </form></section>;

  const signOut = () => { disablePushNotifications(session.token).catch(() => {}); localStorage.removeItem(SESSION_KEY); onSession(null); };
  return <main className="manual-shell visual-shell"><header className="app-header visual-header"><div className="brand"><button className="visual-menu-mark" type="button" aria-label="Abrir menú" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>☰</button><img className="brand-logo" src={appLogo} alt="Centro Portuario de Empleo de Valencia" /><strong>App CPE</strong></div><div className="header-actions"><span>Chapa {session.chapa}</span><button type="button" className={`header-notifications${unreadCount ? ' is-unread' : ''}`} aria-label={`Novedades${unreadCount ? `, ${unreadCount} sin leer` : ''}`} onClick={() => navigate('novedades')}><Bell size={20} />{unreadCount > 0 && <b>{unreadCount}</b>}</button>{session.chapa === '72683' && <button className={tab === 'monitor' ? 'selected' : ''} onClick={() => navigate(tab === 'monitor' ? 'sueldometro' : 'monitor')}>{tab === 'monitor' ? 'Sueldómetro' : 'Monitor'}</button>}<button className="header-signout" onClick={signOut}>Salir</button></div>{menuOpen && <ManualSideMenu tab={tab} isAdmin={isAdmin} showContracting={contractingEnabled} navigate={navigate} onClose={() => setMenuOpen(false)} onLogout={signOut} onDeleteAccount={() => { setMenuOpen(false); setDeleteAccountOpen(true); }} />}</header><div className="visual-content">
    {portalLinkStatus?.portalPasswordIncorrect && <div className="portal-password-warning portal-password-global-notice" role="alert"><p><strong>Contraseña del portal incorrecta.</strong> Revisa los datos en «Vincular portal» e introduce la contraseña de acceso al portal de SEVASA</p><button type="button" className="primary" onClick={() => { sessionStorage.setItem('app-cpe-open-portal-link', '1'); navigate('perfil'); window.dispatchEvent(new Event('app-cpe-open-portal-link')); }}>Vincular portal</button></div>}
    {tab === 'perfil' ? <ProfileSettings session={session} onSession={onSession} />
      : tab === 'cuenta' ? <PasswordSettings session={session} />
      : tab === 'monitor' ? <SectionPage eyebrow="ADMINISTRACIÓN" title="Monitor"><ActivityMonitor session={session} /></SectionPage>
      : tab === 'contratacion' && contractingEnabled ? <div className="contracting-page">{pushState !== 'unsupported' && !pushPromptDone && (pushState !== 'enabled' || String(session.chapa) === '72683') && Date.now() - pushPromptDismissedAt > 30 * 24 * 60 * 60 * 1000 && <div className="home-push-prompt" role="note"><div className="home-push-prompt-icon"><Bell size={22} aria-hidden="true" /></div><div className="home-push-prompt-copy"><strong>¿Quieres recibir avisos?</strong><p>La app te avisará de nuevos jornales y primas, cambios en tus descansos y mensajes.</p>{pushError && <small role="alert">{pushError}</small>}</div><div className="home-push-prompt-actions"><button type="button" className="primary" onClick={enablePush}>Activar notificaciones</button><button type="button" onClick={dismissPushPrompt}>Ahora no</button></div></div>}<section className="visual-page-heading"><div><span>TU JORNADA</span><h1>Mi contratación</h1></div>{personalLinkAvailable && <div className="personal-portal-actions"><form className="personal-portal-link" action="/api/donde-voy" method="post" target="_blank" rel="noopener noreferrer"><input type="hidden" name="token" value={session.token} /><button type="submit">Abrir mi contratación <ExternalLink size={15} aria-hidden="true" /></button></form></div>}</section>{portalLinkStatus && !portalLinkStatus.hasPortalPassword && !personalLinkAvailable && <div className="salary-link-notice" role="note"><span>Vincula la app con el portal para consultar tu contratación y tus próximos jornales.</span><button type="button" onClick={() => { sessionStorage.setItem('app-cpe-open-portal-link', '1'); navigate('perfil'); window.dispatchEvent(new Event('app-cpe-open-portal-link')); }}>Vincular portal</button></div>}<UpcomingAssignments session={session} snapshot={snapshot} /><ManualOperationalSnapshots view="distancias" session={session} onSession={onSession} /></div>
      : tab === 'tablon' ? <SectionPage eyebrow="CONTRATACIÓN COMPLETA" title="Tablón general"><PersonalNoraySectionLink session={session} section="jornada-contratada" label="Contratación" /><GeneralBoard chapa={session.chapa} supabaseOnly showHeading={false} /></SectionPage>
      : (tab === 'puertas' || tab === 'chapero') ? <ManualOperationalSnapshots view={tab} session={session} onSession={onSession} hideDistanceSummary={contractingEnabled} />
      : (tab === 'descansos' || tab === 'vacaciones') ? <SectionPage eyebrow="DESCANSOS Y VACACIONES" title="Intercambios"><ExchangeSection session={session} section={tab} onSectionChange={navigate} onPaidDaysChange={refreshPaidDays} /></SectionPage>
      : tab === 'conversaciones' ? <SectionPage eyebrow="ENTRE COMPAÑEROS" title="Chats"><div className="exchange-area"><ExchangeConversations session={session} /></div></SectionPage>
      : tab === 'novedades' ? <SectionPage eyebrow="ACTIVIDAD" title="Novedades"><ExchangeNotifications rows={notifications} onOpen={openNotification} pushState={pushState} pushError={pushError} onEnablePush={enablePush} onDisablePush={() => optOutPushNotifications(session.token).then(() => { setPushState('idle'); setPushError(''); }).catch((error) => setPushError(error?.message || 'No se pudieron desactivar.'))} onMarkAll={() => { setNotifications((rows) => rows.map((row) => ({ ...row, readAt: row.readAt || new Date().toISOString() }))); markUserNotificationsRead({ token: session.token, all: true }).catch(() => {}); }} /></SectionPage>
      : <>
    {portalLinkStatus && !(portalLinkStatus.hasPortalPassword && portalLinkStatus.hasPremiumKey) && <div className="salary-link-notice" role="note">
      <span>{portalLinkStatus.hasPortalPassword ? 'Guarda tu clave de primas para cargar automáticamente tus jornales y primas.' : 'Para cargar automáticamente tus jornales y primas, vincula la app con el portal.'}</span>
      <button type="button" onClick={() => { sessionStorage.setItem('app-cpe-open-portal-link', '1'); navigate('perfil'); window.dispatchEvent(new Event('app-cpe-open-portal-link')); }}>{portalLinkStatus.hasPortalPassword ? 'Guardar clave de primas' : 'Vincular portal'}</button>
    </div>}
    {error && !showForm && !showPaidForm && <div className="banner error" role="alert">{error}</div>}{notice && <div className="banner success" role="status">{notice}</div>}
    {showImport && <ManualEditorDialog label="Importar jornales" wide onClose={() => setShowImport(false)} busy={busy}><PortalJornalesImport existingItems={months.flatMap((entry) => entry.items)} manualRows={manualRows} busy={busy} onImport={importPastedJornales} onClose={() => setShowImport(false)} /></ManualEditorDialog>}
    {showForm && <ManualEditorDialog label={form.id ? 'Editar jornal' : 'Añadir jornal'} onClose={() => setShowForm(false)} busy={busy}>{jornalEditor}</ManualEditorDialog>}
    {showPaidForm && <ManualEditorDialog label={paidForm.id ? 'Editar día VA / FM' : 'Añadir día VA / FM'} onClose={() => setShowPaidForm(false)} busy={busy}><section className="manual-panel editor paid-day-editor manual-editor-card"><div className="section-head"><h2>{paidForm.id ? 'Editar día VA / FM' : 'Añadir día VA / FM'}</h2><button type="button" disabled={busy} onClick={() => setShowPaidForm(false)}>Cerrar</button></div><form onSubmit={savePaidDay}>{error && <p className="form-error manual-editor-error" role="alert">{error}</p>}
      <label>Fecha<input type="date" value={paidForm.work_date} onChange={(event) => setPaidForm({ ...paidForm, work_date: event.target.value })} required /></label>
      <label>Concepto<select value={paidForm.concept_type} onChange={(event) => setPaidForm({ ...paidForm, concept_type: event.target.value })}><option value="VA">VA · Vacaciones</option><option value="FM">FM · Formación</option></select></label>
      <div className="paid-day-rate"><span>Importe del día</span><strong>{formatEuro(paidForm.concept_type === 'VA' ? VACATION_DAY_RATE : TRAINING_DAY_RATE)}</strong></div>
      <div className="form-actions"><button type="button" disabled={busy} onClick={() => setShowPaidForm(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar día'}</button></div>
    </form></section></ManualEditorDialog>}
    {loading ? <section className="manual-panel"><p>Cargando tu historial…</p></section> : <ManualSalaryDashboard months={months} monthChoices={monthChoices} chosen={chosen} period={period} onPeriodChange={setPeriod} onMonthChange={setMonth} onRefresh={load} irpf={irpf} onIrpfChange={setIrpf} onIrpfSave={() => saveIrpf({ preventDefault() {} })} busy={busy} onImport={() => { setShowImport(true); setShowForm(false); setShowPaidForm(false); setError(''); setNotice(''); }} onAdd={() => { setForm(blank()); setShowForm(true); setShowImport(false); setShowPaidForm(false); setError(''); setNotice(''); }} onAddPaidDay={() => { setPaidForm({ id: null, work_date: today(), concept_type: 'VA' }); setShowPaidForm(true); setShowImport(false); setShowForm(false); setError(''); setNotice(''); }} portalAction={(personalLinkAvailable || doblesLinkAvailable || vacationLinkAvailable) && <div className="personal-portal-actions">{personalLinkAvailable && !contractingEnabled && <form className="personal-portal-link" action="/api/donde-voy" method="post" target="_blank" rel="noopener noreferrer"><input type="hidden" name="token" value={session.token} /><button type="submit">Mi contratación <ExternalLink size={15} aria-hidden="true" /></button></form>}{(personalLinkAvailable || doblesLinkAvailable || vacationLinkAvailable) && <form className="personal-portal-link" action="/api/noray-section" method="post" target="_blank" rel="noopener noreferrer"><input type="hidden" name="token" value={session.token} /><input type="hidden" name="section" value="jornales" /><button type="submit">Jornales y primas <ExternalLink size={15} aria-hidden="true" /></button></form>}{(personalLinkAvailable || doblesLinkAvailable || vacationLinkAvailable) && <form className="personal-portal-link" action="/api/noray-section" method="post" target="_blank" rel="noopener noreferrer"><input type="hidden" name="token" value={session.token} /><input type="hidden" name="section" value="situacion-trabajador" /><button type="submit">Jornada flexible <ExternalLink size={15} aria-hidden="true" /></button></form>}{doblesLinkAvailable && <form className="personal-portal-link" action="/api/noray-section" method="post" target="_blank" rel="noopener noreferrer"><input type="hidden" name="token" value={session.token} /><input type="hidden" name="section" value="dobles" /><button type="submit">Solicitar dobles y HS <ExternalLink size={15} aria-hidden="true" /></button></form>}</div>}>
      {!selected.items.length ? <div className="empty"><strong>No hay jornales en este periodo.</strong><p>Elige otra quincena o un mes del historial.</p></div> : <div className="portal-jornales-list">{selected.items.map((item, index) => <JornalCard key={`${item.source}-${item.id || item.payroll.manualPremiumKey || item.payroll.date}-${index}`} item={item} onOpen={setSelectedDetail} />)}</div>}
    </ManualSalaryDashboard>}{selectedDetailItem && <JornalDetail item={selectedDetailItem} busy={busy} relayBusy={Boolean(savingRelayHourKey)} relayError={relayHourError} onRelayChange={toggleRelayHour} onClose={() => { setSelectedDetail(null); setRelayHourError(''); }} onEdit={edit} onRemove={remove} onPremium={editPremium} onEditPaid={editPaidDay} onRemovePaid={removePaidDay} />}{premiumEditor && <QuickPremiumModal value={premiumEditor.value} onChange={(value) => setPremiumEditor((current) => ({ ...current, value }))} onClose={() => setPremiumEditor(null)} onSave={savePremium} busy={busy} error={premiumError} />}</>}</div>
    <nav className="visual-bottom-nav" aria-label="Secciones de la app">
      {[
        ...(contractingEnabled ? [['contratacion', 'Inicio', House]] : []),
        ['puertas', 'Puertas', DoorOpen],
        ['sueldometro', 'Sueldómetro', WalletCards],
        ['tablon', 'Tablón', ClipboardList],
        ['descansos', 'Descansos', CalendarDays],
        ...(isAdmin && !contractingEnabled ? [['monitor', 'Monitor', Activity]] : [])
      ].map(([page, label, Icon]) => <button key={page} type="button" className={`${page === 'sueldometro' ? 'is-salary' : ''} ${(tab === page || (page === 'descansos' && tab === 'vacaciones')) ? 'is-active' : ''}`.trim()}
        aria-current={(tab === page || (page === 'descansos' && tab === 'vacaciones')) ? 'page' : undefined} onClick={() => navigate(page)}>
        <span className="visual-bottom-icon"><Icon size={21} strokeWidth={(tab === page || (page === 'descansos' && tab === 'vacaciones')) ? 2.5 : 2} />{page === 'novedades' && notifications.some((row) => !row.readAt) && <i aria-hidden="true" />}</span>
        <span>{label}</span>
      </button>)}
    </nav>
    {deleteAccountOpen && <DeleteAccountDialog session={session} onClose={() => setDeleteAccountOpen(false)} onDeleted={() => { localStorage.removeItem(SESSION_KEY); onSession(null); }} />}
  </main>;
}

export function ManualApp() {
  const [session, setSession] = useState(readSession);
  return session ? <Salary session={session} onSession={setSession} /> : <Access onAccess={setSession} />;
}
