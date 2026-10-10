import React, { useEffect, useMemo, useState } from 'react';
import { supabase, loginUser, updateUserPassword, refreshCurrentUser, getUserManualPremiums, setUserManualPremium, getUserRelayHours, getUserRemateHours, loadPayrollConfig, updateUserIrpf, trackUsageEvent, trackPageVisit, getUsageMonitor, getUserNotifications, markUserNotificationsRead, canOpenNorayLinks } from './supabaseClient.js';
import { touchDirectPresence } from './exchangeClient.js';
import { EXCHANGE_PREVIEW_READ_ONLY } from './exchangePreview.js';
import RestExchangePanel from './RestExchangePanel.jsx';
import VacationExchangePanel from './VacationExchangePanel.jsx';
import ExchangeConversations, { conversationHash, directConversationHash } from './ExchangeConversations.jsx';
import { hashForExchangeOffer } from './navigation.js';
import { buildManualSalaryMonths, companyImage, salaryPeriod } from './manualSalary.js';
import { TRAINING_DAY_RATE, VACATION_DAY_RATE, enrichJornales, formatEuro } from './payroll.js';
import { optionsForGroup } from './manualSpecialties.js';
import { specialties as censoSpecialties } from './censo.js';
import { PROFESSIONAL_GROUPS, professionalGroupCode } from './professionalGroups.js';
import { REST_GROUPS } from './restGroups.js';
import { packManualNotes, unpackManualNotes } from './manualMetadata.js';
import { ManualSalaryDashboard } from './ManualSalaryDashboard.jsx';
import GeneralBoard from './GeneralBoard.jsx';
import ManualOperationalSnapshots from './ManualOperationalSnapshots.jsx';
import PersonalNoraySectionLink from './PersonalNoraySectionLink.jsx';
import { Activity, Bell, BriefcaseBusiness, CalendarDays, ChevronRight, ClipboardList, DoorOpen, ExternalLink, Eye, EyeOff, KeyRound, LogOut, MessageCircle, Settings, WalletCards, X } from 'lucide-react';

const SESSION_KEY = 'app-cpe-session';
const appLogo = `${import.meta.env.BASE_URL}logo.jpg`;
const OPERATIONAL_PAGES = new Set(['tablon', 'puertas', 'chapero']);
const ACTIVE_PAGES = new Set(['sueldometro', 'descansos', 'vacaciones', 'conversaciones', 'cuenta', 'perfil', ...OPERATIONAL_PAGES]);
const ACTIVE_NOTIFICATION_TYPES = new Set(['rest_offer_published', 'rest_proposal', 'rest_response', 'rest_message', 'vacation_offer_published', 'vacation_proposal', 'vacation_response', 'vacation_message', 'direct_message']);
const viewFromHash = () => {
  const route = window.location.hash.split('/')[1];
  return ACTIVE_PAGES.has(route) ? route : 'sueldometro';
};
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const blank = () => ({ id: null, work_date: today(), shift: '08-14', specialty: optionsForGroup('II')[0], worker_group: 'II', operation_type: 'ESTIBA', company: '', vessel: '', premium: '0', part: '', notes: '' });
const readSession = () => { try { const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return value?.token && value?.chapa ? value : null; } catch { return null; } };
const euroInput = (value) => Number(String(value).replace(',', '.'));

function ManualSideMenu({ tab, isAdmin, navigate, onClose, onLogout }) {
  const [settingsOpen, setSettingsOpen] = useState(tab === 'cuenta' || tab === 'perfil');
  const item = (page, label, Icon) => <button key={page} type="button" className={tab === page ? 'is-active' : ''} aria-current={tab === page ? 'page' : undefined} onClick={() => navigate(page)}>
    <Icon size={19} aria-hidden="true" /><span>{label}</span><ChevronRight size={16} aria-hidden="true" />
  </button>;
  return <nav className="visual-menu" aria-label="Menú principal">
    <div className="visual-menu-heading"><strong>Secciones</strong><button type="button" aria-label="Cerrar menú" onClick={onClose}><X size={18} /></button></div>
    <div className="visual-menu-group">
      <small>MI CUENTA</small>
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
      <button type="button" onClick={onLogout}><LogOut size={19} aria-hidden="true" /><span>Salir</span></button>
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
    <fieldset><legend>Especialidades <small>Selecciona todas las que tengas</small></legend>
      <div className="manual-profile-specialties">{censoSpecialties.map((specialty) => <label key={specialty.id}>
        <input type="checkbox" checked={selectedSpecialties.includes(specialty.id)} onChange={() => toggleSpecialty(specialty.id)} />
        <span>{specialty.name}</span>
      </label>)}</div>
    </fieldset>
  </div>;
}

function ProfileSettings({ session, onSession }) {
  const [professionalGroup, setProfessionalGroup] = useState(professionalGroupCode(session.professionalGroup));
  const [restGroup, setRestGroup] = useState(session.restGroup || '');
  const [selectedSpecialties, setSelectedSpecialties] = useState(session.specialties || []);
  useEffect(() => {
    setProfessionalGroup(professionalGroupCode(session.professionalGroup));
    setRestGroup(session.restGroup || '');
    setSelectedSpecialties(session.specialties || []);
  }, [session.professionalGroup, session.restGroup, session.specialties]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
  return <SectionPage eyebrow="AJUSTES" title="Mis datos"><section className="manual-panel manual-profile-settings">
    <p>El grupo de intercambio indica con quién puedes cambiar vacaciones. Es distinto del grupo de descansos y del grupo salarial. Las especialidades se usan en Chapero y Puertas.</p>
    <form onSubmit={submit}>
      <ProfileFields {...{ professionalGroup, setProfessionalGroup, restGroup, setRestGroup, selectedSpecialties, setSelectedSpecialties }} professionalGroupSource={session.professionalGroupSource} />
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="banner success" role="status">{notice}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar mis datos'}</button>
    </form>
  </section></SectionPage>;
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
  const [professionalGroup, setProfessionalGroup] = useState('');
  const [restGroup, setRestGroup] = useState('');
  const [selectedSpecialties, setSelectedSpecialties] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (register && !selectedSpecialties.length) throw new Error('Selecciona al menos una especialidad.');
      const session = register
        ? await rpc('app_cpe_register_manual_profile', { p_chapa: chapa, p_password: password, p_email: null, p_professional_group: professionalGroup, p_rest_group: restGroup, p_specialties: selectedSpecialties })
        : await loginUser({ chapa, password });
      if (!session?.token) throw new Error('No se pudo abrir la sesión.');
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      trackUsageEvent({ eventType: register ? 'register' : 'login', chapa: session.chapa }).catch(() => {});
      onAccess(session);
    } catch (reason) { setError(reason.message || 'No se pudo acceder.'); }
    finally { setBusy(false); }
  }
  return <main className="manual-shell access-shell"><section className={`access-card${register ? ' is-registering' : ''}`}>
    <img className="brand-logo access-logo" src={appLogo} alt="Centro Portuario de Empleo de Valencia" />
    <form onSubmit={submit}>
      <label>Chapa<input value={chapa} onChange={(event) => setChapa(event.target.value)} inputMode="numeric" autoComplete="username" required /></label>
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
  const [data, setData] = useState(null);
  const [journalEvents, setJournalEvents] = useState([]);
  const [error, setError] = useState('');
  const [journalError, setJournalError] = useState('');
  const [filter, setFilter] = useState('');
  const load = async () => {
    const [usage, journals] = await Promise.allSettled([
      getUsageMonitor({ token: session.token }),
      rpc('app_cpe_admin_manual_jornal_activity', { p_token: session.token })
    ]);
    if (usage.status === 'fulfilled') { setData(usage.value); setError(''); }
    else setError(usage.reason?.message || 'No se pudo cargar la actividad.');
    if (journals.status === 'fulfilled') { setJournalEvents(journals.value || []); setJournalError(''); }
    else setJournalError(journals.reason?.message || 'No se pudieron cargar los jornales.');
  };
  useEffect(() => { load(); const timer = setInterval(load, 60_000); return () => clearInterval(timer); }, [session.token]);
  const users = (data?.users || []).filter((user) => ACTIVE_PAGES.has(user.lastPage) && String(user.chapa || '').includes(filter));
  const pages = (data?.pages || []).filter((page) => ACTIVE_PAGES.has(page.page));
  const recent = (data?.recent || []).filter((event) => event.type === 'page_visit'
    ? ACTIVE_PAGES.has(event.page) : ['login', 'register', 'app_open'].includes(event.type));
  const visibleJournalEvents = journalEvents.filter((event) => String(event.chapa || '').includes(filter));
  const time = (value) => value ? new Date(value).toLocaleString('es-ES') : '—';
  const workDay = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('es-ES') : '—';
  const action = (value) => ({ added: 'Añadido', edited: 'Editado', deleted: 'Eliminado' })[value] || value;
  return <section className="manual-panel monitor-panel"><div className="section-head"><div><p className="eyebrow">Administración</p><h2>Monitor de actividad</h2></div><button onClick={load}>Actualizar</button></div>
    <p>Accesos y pantallas visitadas durante las últimas 24 horas. Los cambios de jornales manuales se conservan en el registro.</p>
    {error && <p className="form-error">{error}</p>}
    <div className="monitor-numbers"><span><strong>{data?.summary?.uniqueUsers ?? '—'}</strong> usuarios</span><span><strong>{data?.summary?.activeNow ?? '—'}</strong> activos</span><span><strong>{pages.reduce((sum, page) => sum + Number(page.views || 0), 0)}</strong> pantallas vistas</span><span><strong>{data?.summary?.logins ?? '—'}</strong> accesos</span></div>
    <h3>Pantallas</h3><div className="monitor-pages">{pages.map((page) => <span key={page.page}>{page.page}: <strong>{page.views}</strong></span>)}</div>
    <h3>Usuarios recientes</h3><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Buscar chapa" inputMode="numeric" />
    <div className="table-wrap"><table><thead><tr><th>Chapa</th><th>Última pantalla</th><th>Visitas</th><th>Última actividad</th></tr></thead><tbody>{users.map((user) => <tr key={user.chapa}><td>{user.chapa}</td><td>{user.lastPage || '—'}</td><td>{user.views}</td><td>{time(user.lastSeen)}</td></tr>)}</tbody></table></div>
    <h3>Jornales manuales registrados</h3>
    <p>Últimos 200 movimientos. La fecha y hora indican cuándo se añadió, editó o eliminó el jornal.</p>
    {journalError && <p className="form-error" role="alert">{journalError}</p>}
    <div className="table-wrap"><table><thead><tr><th>Fecha y hora</th><th>Chapa</th><th>Acción</th><th>Día del jornal</th><th>Turno</th><th>Puesto</th><th>Grupo</th><th>Operación</th></tr></thead><tbody>
      {visibleJournalEvents.map((event) => <tr key={event.id}><td>{time(event.occurred_at)}</td><td><strong>{event.chapa}</strong></td><td>{action(event.event_type)}</td><td>{workDay(event.work_date)}</td><td>{event.shift}</td><td>{event.specialty}</td><td>{event.worker_group}</td><td>{event.operation_type === 'RECEPCION_ENTREGA' ? 'OC' : 'SP'}</td></tr>)}
    </tbody></table>{!journalError && visibleJournalEvents.length === 0 && <p className="monitor-empty">No hay movimientos de jornales manuales para el filtro actual.</p>}</div>
    <h3>Actividad reciente</h3><div className="recent-list">{recent.slice(0, 30).map((event) => <div key={event.id}><strong>{event.chapa || 'Anónimo'}</strong><span>{event.type === 'page_visit' ? `Visita ${event.page}` : event.type}</span><time>{time(event.at)}</time></div>)}</div>
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
      <div className="portal-jornal-breakdown">
        <span>{paidDay ? 'Importe' : 'Base'} <b>{formatEuro(item.payroll.base)}</b></span>
        {!paidDay && item.payroll.complement > 0 && <span>Complemento <b>{formatEuro(item.payroll.complement)}</b></span>}
        {!paidDay && item.payroll.continuousDoubleMeal > 0 && <span>Manutención doble · {item.payroll.continuousDoubleMealHours} <b>{formatEuro(item.payroll.continuousDoubleMeal)}</b></span>}
        {!paidDay && item.payroll.remate > 0 && <span>Remate · {item.payroll.remateHours} {item.payroll.remateHours === 1 ? 'hora' : 'horas'} <b>{formatEuro(item.payroll.remate)}</b></span>}
        {!paidDay && item.payroll.operationType !== 'RECEPCION_ENTREGA' && <span className={item.payroll.prima > 0 ? 'is-prima' : 'is-pending'}>Prima <b>{item.payroll.prima > 0 ? formatEuro(item.payroll.prima) : 'Pendiente'}</b></span>}
      </div>
    </div>
    <ChevronRight className="portal-jornal-chevron" size={19} />
  </article>;
}

function JornalDetail({ item, busy, onClose, onEdit, onRemove, onPremium, onEditPaid, onRemovePaid }) {
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
    <div className="manual-detail-values"><span>Base <b>{formatEuro(item.payroll.base)}</b></span>{!paidDay && item.payroll.complement > 0 && <span>Complemento <b>{formatEuro(item.payroll.complement)}</b></span>}{!paidDay && <span>Prima <b>{formatEuro(item.payroll.prima || 0)}</b></span>}{!paidDay && item.payroll.remate > 0 && <span>Remate <b>{formatEuro(item.payroll.remate)}</b></span>}<span>Total <b>{formatEuro(item.payroll.total)}</b></span></div>
    {!paidDay && (item.source === 'manual' ? item.manualPart : item.parte) && <p>Parte {item.source === 'manual' ? item.manualPart : item.parte}</p>}{item.notes && <p>{item.notes}</p>}
    <div className="manual-detail-actions">{item.source === 'manual' && <><button disabled={busy} onClick={() => action(onEdit)}>Editar jornal</button><button disabled={busy} onClick={() => action(() => onRemove(item.id))}>Eliminar jornal</button></>}{item.source === 'historico' && <button disabled={busy} onClick={() => action(onPremium)}>Editar prima</button>}{item.source === 'manual_paid_day' && <><button disabled={busy} onClick={() => action(onEditPaid)}>Editar día</button><button disabled={busy} onClick={() => action(() => onRemovePaid(item.id))}>Eliminar día</button></>}</div>
  </section></div>;
}

function ExchangeNotifications({ rows, onOpen, onMarkAll }) {
  return <section className="manual-panel exchange-notifications"><div className="section-head"><div><p className="eyebrow">ACTIVIDAD</p><h2>Actividad reciente</h2></div>
    {rows.some((item) => !item.readAt) && <button type="button" onClick={onMarkAll}>Marcar todo leído</button>}</div>
    <div className="exchange-notification-list">{rows.map((item) => <button type="button" key={item.id}
      className={item.readAt ? 'is-read' : 'is-unread'} onClick={() => onOpen(item)}>
      <span className="exchange-notification-icon"><Bell size={19} aria-hidden="true" /></span>
      <span className="exchange-notification-copy"><strong>{item.title}</strong><span>{item.body}</span><small>{new Date(item.createdAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</small></span>
      <ChevronRight size={19} className="exchange-notification-arrow" aria-hidden="true" />
    </button>)}</div>
  </section>;
}

function ExchangeSection({ session, section, onSectionChange }) {
  return <div className="exchange-area"><div className="exchange-type-switch" role="tablist" aria-label="Tipo de intercambio">
    <button type="button" role="tab" aria-selected={section === 'descansos'} className={section === 'descansos' ? 'is-active' : ''} onClick={() => onSectionChange('descansos')}>Descansos</button>
    <button type="button" role="tab" aria-selected={section === 'vacaciones'} className={section === 'vacaciones' ? 'is-active' : ''} onClick={() => onSectionChange('vacaciones')}>Vacaciones</button>
  </div>{section === 'vacaciones' ? <VacationExchangePanel session={session} /> : <RestExchangePanel session={session} />}</div>;
}

function Salary({ session, onSession }) {
  const [snapshot, setSnapshot] = useState(null);
  const [manualRows, setManualRows] = useState([]);
  const [paidRows, setPaidRows] = useState([]);
  const [premiums, setPremiums] = useState({});
  const [relayHours, setRelayHours] = useState({});
  const [remateHours, setRemateHours] = useState({});
  const [config, setConfig] = useState(null);
  const [month, setMonth] = useState('');
  const [period, setPeriod] = useState(() => new Date().getDate() <= 15 ? 'first' : 'second');
  const [form, setForm] = useState(blank);
  const [showForm, setShowForm] = useState(false);
  const [paidForm, setPaidForm] = useState({ id: null, work_date: today(), concept_type: 'VA' });
  const [showPaidForm, setShowPaidForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const isAdmin = session.chapa === '72683';
  const [tab, setTab] = useState(viewFromHash);
  const [notifications, setNotifications] = useState([]);
  const [personalLinkAvailable, setPersonalLinkAvailable] = useState(false);
  const [doblesLinkAvailable, setDoblesLinkAvailable] = useState(false);
  const [vacationLinkAvailable, setVacationLinkAvailable] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [irpf, setIrpf] = useState(Number(session.irpfRate) || 0);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [oldData, newRows, paidDays, premiumData, rateData, relayData, remateData] = await Promise.all([
        rpc('app_cpe_get_saved_salary_history', { p_token: session.token }),
        rpc('app_cpe_list_manual_jornales', { p_token: session.token }),
        rpc('app_cpe_list_manual_paid_days', { p_token: session.token }),
        getUserManualPremiums({ token: session.token }), loadPayrollConfig(),
        getUserRelayHours({ token: session.token }), getUserRemateHours({ token: session.token })
      ]);
      setSnapshot(oldData); setManualRows(newRows || []); setPaidRows(paidDays || []); setPremiums(premiumData || {}); setConfig(rateData); setRelayHours(relayData || {}); setRemateHours(remateData || {});
    } catch (reason) { setError(reason.message || 'No se pudieron cargar los datos.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); if (!session.supportAccess) trackUsageEvent({ eventType: 'app_open', chapa: session.chapa }).catch(() => {}); }, [session.token]);
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
    };
    followHash();
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, []);
  useEffect(() => { if (!session.supportAccess && ACTIVE_PAGES.has(tab)) trackPageVisit({ token: session.token, page: tab }).catch(() => {}); }, [session.token, session.supportAccess, tab]);
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
      .then((data) => { if (active) setNotifications((data.rows || []).filter((row) => ACTIVE_NOTIFICATION_TYPES.has(row.eventType))); })
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

  const navigate = (next) => { const page = (next === 'monitor' && isAdmin) || next === 'novedades' || ACTIVE_PAGES.has(next) ? next : 'sueldometro'; setTab(page); setMenuOpen(false); if (page !== 'monitor' && page !== 'novedades') window.location.hash = `#/${page}`; };
  const openNotification = (item) => {
    if (!item.readAt) {
      setNotifications((rows) => rows.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row));
      markUserNotificationsRead({ token: session.token, notificationId: item.id }).catch(() => {});
    }
    const section = item.eventType?.startsWith('vacation_') ? 'vacaciones' : 'descansos';
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

  const months = useMemo(() => buildManualSalaryMonths(snapshot, manualRows, config, premiums, relayHours, remateHours, paidRows), [snapshot, manualRows, config, premiums, relayHours, remateHours, paidRows]);
  const currentMonthKey = today().slice(0, 7);
  const selectedMonthKey = month || currentMonthKey;
  const chosen = months.find((item) => item.key === selectedMonthKey) || {
    key: selectedMonthKey,
    label: new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(Number(selectedMonthKey.slice(0, 4)), Number(selectedMonthKey.slice(5, 7)) - 1, 1)),
    items: [], total: 0
  };
  const monthChoices = months.some((item) => item.key === chosen.key) ? months : [chosen, ...months];
  const selected = salaryPeriod(chosen?.items, period);
  const formEstimate = useMemo(() => {
    if (!form.work_date || !form.specialty) return null;
    const [, monthNumber, day] = form.work_date.split('-');
    const raw = { dia: Number(day), jornada: form.shift, especialidad: form.specialty, payrollGroup: form.worker_group,
      operacion: form.operation_type === 'RECEPCION_ENTREGA' ? 'RECEPCION Y ENTREGA' : 'ESTIBA', parte: 'MANUAL-PREVIA' };
    const calculated = enrichJornales([raw], [], `${monthNumber}/${form.work_date.slice(0, 4)}`, config)[0]?.payroll;
    if (!calculated) return null;
    const premium = euroInput(form.premium);
    return { ...calculated, total: Number((calculated.total + (Number.isFinite(premium) ? premium : 0)).toFixed(2)) };
  }, [form, config]);

  async function save(event) {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      const premium = euroInput(form.premium);
      if (!Number.isFinite(premium) || premium < 0) throw new Error('Introduce una prima válida.');
      const saved = await rpc('app_cpe_save_manual_jornal', { p_token: session.token, p_id: form.id,
        p_work_date: form.work_date, p_shift: form.shift, p_specialty: form.specialty.trim(),
        p_worker_group: form.worker_group, p_operation_type: form.operation_type, p_premium: premium,
        p_notes: packManualNotes(form) });
      setManualRows((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      setMonth(saved.work_date.slice(0, 7)); setShowForm(false); setForm(blank()); setNotice('Jornal guardado.');
    } catch (reason) { setError(reason.message || 'No se pudo guardar el jornal.'); }
    finally { setBusy(false); }
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
  async function editHistoricPremium(item) {
    const value = window.prompt('Prima manual en euros (0 si no hubo prima):', String(item.payroll.prima ?? 0));
    if (value === null) return;
    const amount = euroInput(value);
    if (!Number.isFinite(amount) || amount < 0) { setError('Introduce un importe válido.'); return; }
    setBusy(true); setError('');
    try {
      await setUserManualPremium({ token: session.token, jornalKey: item.payroll.manualPremiumKey, amount, portalAmount: item.payroll.portalPrima });
      setPremiums(await getUserManualPremiums({ token: session.token })); setNotice('Prima guardada.');
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  async function saveIrpf(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await updateUserIrpf({ token: session.token, irpfRate: irpf }); const next = { ...session, ...result, irpfRate: irpf }; localStorage.setItem(SESSION_KEY, JSON.stringify(next)); onSession(next); setNotice('IRPF guardado.'); }
    catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  const edit = (item) => { const row = manualRows.find((entry) => entry.id === item.id); if (!row) return; setForm({ ...row, ...unpackManualNotes(row.notes), premium: String(row.premium) }); setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const editPaidDay = (item) => { setPaidForm({ id: item.id, work_date: item.payroll.date, concept_type: item.isVacation ? 'VA' : 'FM' }); setShowPaidForm(true); setShowForm(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return <main className="manual-shell visual-shell"><header className="app-header visual-header"><div className="brand"><button className="visual-menu-mark" type="button" aria-label="Abrir menú" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>☰</button><img className="brand-logo" src={appLogo} alt="Centro Portuario de Empleo de Valencia" /><strong>App CPE</strong></div><div className="header-actions"><span>Chapa {session.chapa}</span><button type="button" aria-label={`Novedades${notifications.filter((row) => !row.readAt).length ? `, ${notifications.filter((row) => !row.readAt).length} sin leer` : ''}`} onClick={() => navigate('novedades')}><Bell size={20} />{notifications.filter((row) => !row.readAt).length > 0 && <b>{notifications.filter((row) => !row.readAt).length}</b>}</button>{session.chapa === '72683' && <button className={tab === 'monitor' ? 'selected' : ''} onClick={() => navigate(tab === 'monitor' ? 'sueldometro' : 'monitor')}>{tab === 'monitor' ? 'Sueldómetro' : 'Monitor'}</button>}<button onClick={() => { localStorage.removeItem(SESSION_KEY); onSession(null); }}>Salir</button></div>{menuOpen && <ManualSideMenu tab={tab} isAdmin={isAdmin} navigate={navigate} onClose={() => setMenuOpen(false)} onLogout={() => { localStorage.removeItem(SESSION_KEY); onSession(null); }} />}</header><div className="visual-content">
    {tab === 'perfil' ? <ProfileSettings session={session} onSession={onSession} />
      : tab === 'cuenta' ? <PasswordSettings session={session} />
      : tab === 'monitor' ? <SectionPage eyebrow="ADMINISTRACIÓN" title="Monitor"><ActivityMonitor session={session} /></SectionPage>
      : tab === 'tablon' ? <SectionPage eyebrow="CONTRATACIÓN COMPLETA" title="Tablón general"><PersonalNoraySectionLink session={session} section="jornada-contratada" label="Contratación Jornada" /><GeneralBoard chapa={session.chapa} supabaseOnly showHeading={false} /></SectionPage>
      : (tab === 'puertas' || tab === 'chapero') ? <ManualOperationalSnapshots view={tab} session={session} onSession={onSession} />
      : (tab === 'descansos' || tab === 'vacaciones') ? <SectionPage eyebrow="DESCANSOS Y VACACIONES" title="Intercambios"><ExchangeSection session={session} section={tab} onSectionChange={navigate} /></SectionPage>
      : tab === 'conversaciones' ? <SectionPage eyebrow="ENTRE COMPAÑEROS" title="Chats"><div className="exchange-area"><ExchangeConversations session={session} /></div></SectionPage>
      : tab === 'novedades' ? <SectionPage eyebrow="ACTIVIDAD" title="Novedades"><ExchangeNotifications rows={notifications} onOpen={openNotification} onMarkAll={() => { setNotifications((rows) => rows.map((row) => ({ ...row, readAt: row.readAt || new Date().toISOString() }))); markUserNotificationsRead({ token: session.token, all: true }).catch(() => {}); }} /></SectionPage>
      : <>
    {error && <div className="banner error" role="alert">{error}</div>}{notice && <div className="banner success" role="status">{notice}</div>}
    {showForm && <section className="manual-panel editor manual-editor-card manual-jornal-editor"><div className="section-head"><h2>{form.id ? 'Editar jornal' : 'Nuevo jornal'}</h2><button onClick={() => setShowForm(false)}>Cerrar</button></div><form onSubmit={save}>
      <label>Fecha<input type="date" value={form.work_date} onChange={(event) => setForm({ ...form, work_date: event.target.value })} required /></label>
      <label>Turno<select value={form.shift} onChange={(event) => setForm({ ...form, shift: event.target.value })}>{['02-08','06-12','08-14','14-20','18-00','19-01','20-02'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Grupo<select value={form.worker_group} onChange={(event) => { const worker_group = event.target.value; setForm({ ...form, worker_group, specialty: optionsForGroup(worker_group)[0] }); }}>{['I','II','III','IV'].map((value) => <option key={value} value={value}>Grupo {value}</option>)}</select></label>
      <label>Puesto / especialidad<select value={form.specialty} onChange={(event) => setForm({ ...form, specialty: event.target.value })} required>{optionsForGroup(form.worker_group, form.specialty).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Tipo de operación<select value={form.operation_type} onChange={(event) => setForm({ ...form, operation_type: event.target.value })}><option value="ESTIBA">Servicio público (SP)</option><option value="RECEPCION_ENTREGA">Operaciones complementarias (OC)</option></select></label>
      <label>Empresa o terminal<select value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })}><option value="">Sin indicar</option><option value="CSP">CSP</option><option value="TCV">TCV</option><option value="APM">APM</option><option value="MSC">MSC</option><option value="VTEU">VTEU</option><option value="ERH">ERH</option><option value="BALEARIA">Baleària</option><option value="TRASMED">Trasmed</option><option value="CPE">CPE</option></select></label>
      <label>Buque (opcional)<input value={form.vessel} onChange={(event) => setForm({ ...form, vessel: event.target.value })} maxLength="100" /></label>
      <label>Prima (€)<input inputMode="decimal" value={form.premium} onChange={(event) => setForm({ ...form, premium: event.target.value })} required /></label>
      <label className="wide">N.º de parte (opcional)<input value={form.part} onChange={(event) => setForm({ ...form, part: event.target.value })} inputMode="numeric" pattern="[0-9]*" maxLength="12" placeholder="Número de parte" /></label>
      {formEstimate && <div className="form-estimate"><span>Tarifa del grupo {form.worker_group}</span><strong>{formatEuro(formEstimate.base)}</strong><span>Complemento del puesto</span><strong>{formatEuro(formEstimate.complement)}</strong><span>Prima introducida</span><strong>{formatEuro(euroInput(form.premium))}</strong><span>Total del jornal</span><strong>{formatEuro(formEstimate.total)}</strong></div>}
      <div className="form-actions"><button type="button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar jornal'}</button></div>
    </form></section>}
    {showPaidForm && <section className="manual-panel editor paid-day-editor manual-editor-card"><div className="section-head"><h2>{paidForm.id ? 'Editar día VA / FM' : 'Añadir día VA / FM'}</h2><button type="button" onClick={() => setShowPaidForm(false)}>Cerrar</button></div><form onSubmit={savePaidDay}>
      <label>Fecha<input type="date" value={paidForm.work_date} onChange={(event) => setPaidForm({ ...paidForm, work_date: event.target.value })} required /></label>
      <label>Concepto<select value={paidForm.concept_type} onChange={(event) => setPaidForm({ ...paidForm, concept_type: event.target.value })}><option value="VA">VA · Vacaciones</option><option value="FM">FM · Formación</option></select></label>
      <div className="paid-day-rate"><span>Importe del día</span><strong>{formatEuro(paidForm.concept_type === 'VA' ? VACATION_DAY_RATE : TRAINING_DAY_RATE)}</strong></div>
      <div className="form-actions"><button type="button" onClick={() => setShowPaidForm(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar día'}</button></div>
    </form></section>}
    {loading ? <section className="manual-panel"><p>Cargando tu historial…</p></section> : <ManualSalaryDashboard months={months} monthChoices={monthChoices} chosen={chosen} period={period} onPeriodChange={setPeriod} onMonthChange={setMonth} onRefresh={load} irpf={irpf} onIrpfChange={setIrpf} onIrpfSave={() => saveIrpf({ preventDefault() {} })} busy={busy} onAdd={() => { setForm(blank()); setShowForm(true); setShowPaidForm(false); setNotice(''); }} onAddPaidDay={() => { setPaidForm({ id: null, work_date: today(), concept_type: 'VA' }); setShowPaidForm(true); setShowForm(false); setNotice(''); }} portalAction={(personalLinkAvailable || doblesLinkAvailable || vacationLinkAvailable) && <div className="personal-portal-actions">{personalLinkAvailable && <form className="personal-portal-link" action="/api/donde-voy" method="post" target="_blank" rel="noopener noreferrer"><input type="hidden" name="token" value={session.token} /><button type="submit">Abrir mi contratación <ExternalLink size={15} aria-hidden="true" /></button></form>}{(personalLinkAvailable || doblesLinkAvailable || vacationLinkAvailable) && <form className="personal-portal-link" action="/api/noray-section" method="post" target="_blank" rel="noopener noreferrer"><input type="hidden" name="token" value={session.token} /><input type="hidden" name="section" value="jornales" /><button type="submit">Jornales y primas <ExternalLink size={15} aria-hidden="true" /></button></form>}{doblesLinkAvailable && <form className="personal-portal-link" action="/api/noray-section" method="post" target="_blank" rel="noopener noreferrer"><input type="hidden" name="token" value={session.token} /><input type="hidden" name="section" value="dobles" /><button type="submit">Solicitar dobles y HS <ExternalLink size={15} aria-hidden="true" /></button></form>}</div>}>
      {!selected.items.length ? <div className="empty"><strong>No hay jornales en este periodo.</strong><p>Elige otra quincena o un mes del historial.</p></div> : <div className="portal-jornales-list">{selected.items.map((item, index) => <JornalCard key={`${item.source}-${item.id || item.payroll.manualPremiumKey || item.payroll.date}-${index}`} item={item} onOpen={setSelectedDetail} />)}</div>}
    </ManualSalaryDashboard>}{selectedDetail && <JornalDetail item={selectedDetail} busy={busy} onClose={() => setSelectedDetail(null)} onEdit={edit} onRemove={remove} onPremium={editHistoricPremium} onEditPaid={editPaidDay} onRemovePaid={removePaidDay} />}</>}</div>
    <nav className="visual-bottom-nav" aria-label="Secciones de la app">
      {[
        ['chapero', 'Chapero', BriefcaseBusiness],
        ['puertas', 'Puertas', DoorOpen],
        ['sueldometro', 'Sueldómetro', WalletCards],
        ['tablon', 'Tablón', ClipboardList],
        ['descansos', 'Intercambios', CalendarDays],
        ...(isAdmin ? [['monitor', 'Monitor', Activity]] : [])
      ].map(([page, label, Icon]) => <button key={page} type="button" className={(tab === page || (page === 'descansos' && tab === 'vacaciones')) ? 'is-active' : ''}
        aria-current={(tab === page || (page === 'descansos' && tab === 'vacaciones')) ? 'page' : undefined} onClick={() => navigate(page)}>
        <span className="visual-bottom-icon"><Icon size={21} strokeWidth={(tab === page || (page === 'descansos' && tab === 'vacaciones')) ? 2.5 : 2} />{page === 'novedades' && notifications.some((row) => !row.readAt) && <i aria-hidden="true" />}</span>
        <span>{label}</span>
      </button>)}
    </nav>
  </main>;
}

export function ManualApp() {
  const [session, setSession] = useState(readSession);
  return session ? <Salary session={session} onSession={setSession} /> : <Access onAccess={setSession} />;
}
