import React, { useEffect, useMemo, useState } from 'react';
import { supabase, loginUser, getUserManualPremiums, setUserManualPremium, getUserRelayHours, getUserRemateHours, loadPayrollConfig, updateUserIrpf, trackUsageEvent, trackPageVisit, getUsageMonitor } from './supabaseClient.js';
import { buildManualSalaryMonths, companyImage, salaryPeriod } from './manualSalary.js';
import { TRAINING_DAY_RATE, VACATION_DAY_RATE, enrichJornales, formatEuro } from './payroll.js';
import { optionsForGroup } from './manualSpecialties.js';
import { packManualNotes, unpackManualNotes } from './manualMetadata.js';
import { ManualSalaryDashboard } from './ManualSalaryDashboard.jsx';
import { ChevronRight, X } from 'lucide-react';

const SESSION_KEY = 'app-cpe-session';
const appLogo = `${import.meta.env.BASE_URL}logo.jpg`;
const TEMPORARY_NOTICE = 'Aviso temporal: Por el momento, solo está disponible el Sueldómetro manual. Puedes consultar tus jornales guardados y añadir nuevos jornales y primas. El resto de funciones volverá cuando se solucionen los problemas de acceso al portal';
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const blank = () => ({ id: null, work_date: today(), shift: '08-14', specialty: 'CONDUCTOR 1a', worker_group: 'II', operation_type: 'ESTIBA', company: '', vessel: '', premium: '0', notes: '' });
const readSession = () => { try { const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return value?.token && value?.chapa ? value : null; } catch { return null; } };
const euroInput = (value) => Number(String(value).replace(',', '.'));

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
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const session = register
        ? await rpc('app_cpe_register_manual', { p_chapa: chapa, p_password: password, p_email: email })
        : await loginUser({ chapa, password });
      if (!session?.token) throw new Error('No se pudo abrir la sesión.');
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      trackUsageEvent({ eventType: register ? 'register' : 'login', chapa: session.chapa }).catch(() => {});
      onAccess(session);
    } catch (reason) { setError(reason.message || 'No se pudo acceder.'); }
    finally { setBusy(false); }
  }
  return <main className="manual-shell access-shell"><section className="access-card">
    <img className="brand-logo access-logo" src={appLogo} alt="Centro Portuario de Empleo de Valencia" /><p className="eyebrow">APP CPE</p><h1>Tu Sueldómetro</h1>
    <p>Registra tus jornales y primas. Tus datos anteriores se conservan en tu cuenta.</p>
    <div className="temporary-notice" role="note">{TEMPORARY_NOTICE}</div>
    <form onSubmit={submit}>
      <label>Chapa<input value={chapa} onChange={(event) => setChapa(event.target.value)} inputMode="numeric" autoComplete="username" required /></label>
      {register && <label>Correo electrónico<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>}
      <label>Contraseña de esta app<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : undefined} required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Un momento…' : register ? 'Crear cuenta' : 'Entrar'}</button>
    </form>
    <button className="text-button" type="button" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Ya tengo cuenta' : 'Crear cuenta nueva'}</button>
    <small>El registro solo requiere credenciales de App CPE.</small>
  </section></main>;
}

function ActivityMonitor({ session }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const load = () => getUsageMonitor({ token: session.token }).then(setData).catch((reason) => setError(reason.message));
  useEffect(() => { load(); const timer = setInterval(load, 60_000); return () => clearInterval(timer); }, [session.token]);
  const users = (data?.users || []).filter((user) => String(user.chapa || '').includes(filter));
  const time = (value) => value ? new Date(value).toLocaleString('es-ES') : '—';
  return <section className="manual-panel monitor-panel"><div className="section-head"><div><p className="eyebrow">Administración</p><h2>Monitor de actividad</h2></div><button onClick={load}>Actualizar</button></div>
    <p>Accesos y pantallas visitadas durante las últimas 24 horas.</p>
    {error && <p className="form-error">{error}</p>}
    <div className="monitor-numbers"><span><strong>{data?.summary?.uniqueUsers ?? '—'}</strong> usuarios</span><span><strong>{data?.summary?.activeNow ?? '—'}</strong> activos</span><span><strong>{data?.summary?.pageViews ?? '—'}</strong> pantallas vistas</span><span><strong>{data?.summary?.logins ?? '—'}</strong> accesos</span></div>
    <h3>Pantallas</h3><div className="monitor-pages">{(data?.pages || []).map((page) => <span key={page.page}>{page.page}: <strong>{page.views}</strong></span>)}</div>
    <h3>Usuarios recientes</h3><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Buscar chapa" inputMode="numeric" />
    <div className="table-wrap"><table><thead><tr><th>Chapa</th><th>Última pantalla</th><th>Visitas</th><th>Última actividad</th></tr></thead><tbody>{users.map((user) => <tr key={user.chapa}><td>{user.chapa}</td><td>{user.lastPage || '—'}</td><td>{user.views}</td><td>{time(user.lastSeen)}</td></tr>)}</tbody></table></div>
    <h3>Actividad reciente</h3><div className="recent-list">{(data?.recent || []).slice(0, 30).map((event) => <div key={event.id}><strong>{event.chapa || 'Anónimo'}</strong><span>{event.type === 'page_visit' ? `Visita ${event.page}` : event.type}</span><time>{time(event.at)}</time></div>)}</div>
  </section>;
}

function JornalCard({ item, onOpen }) {
  const paidDay = item.isVacation || item.isTraining;
  const logo = paidDay ? '' : companyImage(item.empresa);
  const destination = [item.buque, item.empresa].filter((value) => value && !/^(?:--?|—)$/.test(String(value).trim())).join(' · ');
  return <article className={`production-jornal${logo ? ' has-company-logo' : ''}${item.isVacation ? ' is-vacation' : ''}${item.isTraining ? ' is-training' : ''}`} style={logo ? { '--jornal-company-logo': `url("${logo}")` } : undefined} role="button" tabIndex={0} aria-label={`Ver detalle del ${paidDay ? 'día' : 'jornal'} del día ${item.dia || item.payroll.date.slice(-2)}`} onClick={() => onOpen(item)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(item); } }}>
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
    {!paidDay && item.parte && <p>Parte {item.parte}</p>}{item.notes && <p>{item.notes}</p>}
    <div className="manual-detail-actions">{item.source === 'manual' && <><button disabled={busy} onClick={() => action(onEdit)}>Editar jornal</button><button disabled={busy} onClick={() => action(() => onRemove(item.id))}>Eliminar jornal</button></>}{item.source === 'historico' && <button disabled={busy} onClick={() => action(onPremium)}>Editar prima</button>}{item.source === 'manual_paid_day' && <><button disabled={busy} onClick={() => action(onEditPaid)}>Editar día</button><button disabled={busy} onClick={() => action(() => onRemovePaid(item.id))}>Eliminar día</button></>}</div>
  </section></div>;
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
  const [tab, setTab] = useState('salary');
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
  useEffect(() => { if (!session.supportAccess) trackPageVisit({ token: session.token, page: tab === 'monitor' ? 'inicio' : 'sueldometro' }).catch(() => {}); }, [session.token, tab]);

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

  return <main className="manual-shell visual-shell"><header className="app-header visual-header"><div className="brand"><button className="visual-menu-mark" type="button" aria-label="Abrir menú" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>☰</button><img className="brand-logo" src={appLogo} alt="Centro Portuario de Empleo de Valencia" /><strong>App CPE</strong></div><div className="header-actions"><span>Chapa {session.chapa}</span>{session.chapa === '72683' && <button className={tab === 'monitor' ? 'selected' : ''} onClick={() => setTab(tab === 'monitor' ? 'salary' : 'monitor')}>{tab === 'monitor' ? 'Sueldómetro' : 'Monitor'}</button>}<button onClick={() => { localStorage.removeItem(SESSION_KEY); onSession(null); }}>Salir</button></div>{menuOpen && <nav className="visual-menu" aria-label="Menú principal"><button type="button" onClick={() => { setTab('salary'); setMenuOpen(false); }}>Sueldómetro</button>{session.chapa === '72683' && <button type="button" onClick={() => { setTab('monitor'); setMenuOpen(false); }}>Monitor de actividad</button>}<button type="button" onClick={() => { localStorage.removeItem(SESSION_KEY); onSession(null); }}>Salir</button></nav>}</header><div className="visual-content">
    {tab === 'monitor' ? <ActivityMonitor session={session} /> : <>
    {error && <div className="banner error" role="alert">{error}</div>}{notice && <div className="banner success" role="status">{notice}</div>}
    {showForm && <section className="manual-panel editor"><div className="section-head"><h2>{form.id ? 'Editar jornal' : 'Nuevo jornal'}</h2><button onClick={() => setShowForm(false)}>Cerrar</button></div><form onSubmit={save}>
      <label>Fecha<input type="date" value={form.work_date} onChange={(event) => setForm({ ...form, work_date: event.target.value })} required /></label>
      <label>Turno<select value={form.shift} onChange={(event) => setForm({ ...form, shift: event.target.value })}>{['02-08','06-12','08-14','14-20','18-00','19-01','20-02'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Grupo<select value={form.worker_group} onChange={(event) => { const worker_group = event.target.value; setForm({ ...form, worker_group, specialty: optionsForGroup(worker_group)[0] }); }}>{['I','II','III','IV'].map((value) => <option key={value} value={value}>Grupo {value}</option>)}</select></label>
      <label>Puesto / especialidad<select value={form.specialty} onChange={(event) => setForm({ ...form, specialty: event.target.value })} required>{optionsForGroup(form.worker_group, form.specialty).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Tipo de operación<select value={form.operation_type} onChange={(event) => setForm({ ...form, operation_type: event.target.value })}><option value="ESTIBA">Servicio público (SP)</option><option value="RECEPCION_ENTREGA">Operaciones complementarias (OC)</option></select></label>
      <label>Empresa o terminal<select value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })}><option value="">Sin indicar</option><option value="CSP">CSP</option><option value="TCV">TCV</option><option value="APM">APM</option><option value="MSC">MSC</option><option value="VTEU">VTEU</option><option value="ERH">ERH</option><option value="BALEARIA">Baleària</option><option value="TRASMED">Trasmed</option><option value="CPE">CPE</option></select></label>
      <label>Buque (opcional)<input value={form.vessel} onChange={(event) => setForm({ ...form, vessel: event.target.value })} maxLength="100" /></label>
      <label>Prima (€)<input inputMode="decimal" value={form.premium} onChange={(event) => setForm({ ...form, premium: event.target.value })} required /></label>
      <label className="wide">Notas (opcional)<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength="500" /></label>
      {formEstimate && <div className="form-estimate"><span>Tarifa del grupo {form.worker_group}</span><strong>{formatEuro(formEstimate.base)}</strong><span>Complemento del puesto</span><strong>{formatEuro(formEstimate.complement)}</strong><span>Prima introducida</span><strong>{formatEuro(euroInput(form.premium))}</strong><span>Total del jornal</span><strong>{formatEuro(formEstimate.total)}</strong></div>}
      <div className="form-actions"><button type="button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar jornal'}</button></div>
    </form></section>}
    {showPaidForm && <section className="manual-panel editor paid-day-editor"><div className="section-head"><h2>{paidForm.id ? 'Editar día VA / FM' : 'Añadir día VA / FM'}</h2><button type="button" onClick={() => setShowPaidForm(false)}>Cerrar</button></div><form onSubmit={savePaidDay}>
      <label>Fecha<input type="date" value={paidForm.work_date} onChange={(event) => setPaidForm({ ...paidForm, work_date: event.target.value })} required /></label>
      <label>Concepto<select value={paidForm.concept_type} onChange={(event) => setPaidForm({ ...paidForm, concept_type: event.target.value })}><option value="VA">VA · Vacaciones</option><option value="FM">FM · Formación</option></select></label>
      <div className="paid-day-rate"><span>Importe del día</span><strong>{formatEuro(paidForm.concept_type === 'VA' ? VACATION_DAY_RATE : TRAINING_DAY_RATE)}</strong></div>
      <div className="form-actions"><button type="button" onClick={() => setShowPaidForm(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar día'}</button></div>
    </form></section>}
    {loading ? <section className="manual-panel"><p>Cargando tu historial…</p></section> : <ManualSalaryDashboard months={months} monthChoices={monthChoices} chosen={chosen} period={period} onPeriodChange={setPeriod} onMonthChange={setMonth} onRefresh={load} irpf={irpf} onIrpfChange={setIrpf} onIrpfSave={() => saveIrpf({ preventDefault() {} })} busy={busy} onAdd={() => { setForm(blank()); setShowForm(true); setShowPaidForm(false); setNotice(''); }} onAddPaidDay={() => { setPaidForm({ id: null, work_date: today(), concept_type: 'VA' }); setShowPaidForm(true); setShowForm(false); setNotice(''); }}>
      {!selected.items.length ? <div className="empty"><strong>No hay jornales en este periodo.</strong><p>Elige otra quincena o un mes del historial.</p></div> : <div className="portal-jornales-list">{selected.items.map((item, index) => <JornalCard key={`${item.source}-${item.id || item.payroll.manualPremiumKey || item.payroll.date}-${index}`} item={item} onOpen={setSelectedDetail} />)}</div>}
    </ManualSalaryDashboard>}{selectedDetail && <JornalDetail item={selectedDetail} busy={busy} onClose={() => setSelectedDetail(null)} onEdit={edit} onRemove={remove} onPremium={editHistoricPremium} onEditPaid={editPaidDay} onRemovePaid={removePaidDay} />}</>}</div>
  </main>;
}

export function ManualApp() {
  const [session, setSession] = useState(readSession);
  return session ? <Salary session={session} onSession={setSession} /> : <Access onAccess={setSession} />;
}
