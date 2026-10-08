import React, { useEffect, useMemo, useState } from 'react';
import { supabase, loginUser, getUserManualPremiums, setUserManualPremium, getUserRelayHours, getUserRemateHours, loadPayrollConfig, updateUserIrpf, trackUsageEvent, trackPageVisit, getUsageMonitor } from './supabaseClient.js';
import { buildManualSalaryMonths, companyImage, salaryPeriod } from './manualSalary.js';
import { enrichJornales, formatEuro } from './payroll.js';
import { optionsForGroup } from './manualSpecialties.js';
import { packManualNotes, unpackManualNotes } from './manualMetadata.js';

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

function JornalCard({ item, busy, onEdit, onRemove, onPremium }) {
  const company = String(item.empresa || '').trim();
  const logo = companyImage(company);
  const date = new Date(`${item.payroll.date}T12:00:00`);
  return <article className={`jornal-card${logo ? ' has-company-art' : ''}`} style={logo ? { '--jornal-company-logo': `url("${logo}")` } : undefined}>
    <div className="jornal-art">
      {logo ? <img src={logo} alt={company} loading="lazy" /> : <span className="jornal-monogram">{company ? company.slice(0, 4).toUpperCase() : 'CPE'}</span>}
      <span className="jornal-day">{date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</span>
    </div>
    <div className="jornal-body">
      <div className="jornal-heading"><div><small>{[company, item.tipo, item.payroll.shift].filter(Boolean).join(' · ')}</small><h3>{item.especialidad || 'Jornal'}</h3></div><strong>{formatEuro(item.payroll.total)}</strong></div>
      <p>{[item.buque, item.source === 'manual' ? (item.payroll.operationType === 'RECEPCION_ENTREGA' ? 'Operaciones complementarias (OC) · Recepción y entrega' : 'Servicio público (SP)') : item.operacion || (item.payroll.operationType === 'RECEPCION_ENTREGA' ? 'Operaciones complementarias (OC)' : 'Servicio público (SP)')].filter(Boolean).join(' · ')}</p>
      <div className="jornal-meta"><span>Grupo {item.payroll.group}</span>{item.source === 'historico' && item.parte && <span>Parte {item.parte}</span>}{item.jornal && <span>Jornal {item.jornal}</span>}</div>
      <div className="jornal-breakdown"><span>Base <b>{formatEuro(item.payroll.base)}</b></span>{item.payroll.complement > 0 && <span>Complemento <b>{formatEuro(item.payroll.complement)}</b></span>}<span>Prima <b>{formatEuro(item.payroll.prima || 0)}</b></span>{item.payroll.relayHour > 0 && <span>Relevo <b>{formatEuro(item.payroll.relayHour)}</b></span>}{item.payroll.remate > 0 && <span>Remate <b>{formatEuro(item.payroll.remate)}</b></span>}{item.payroll.continuousDoubleMeal > 0 && <span>Manutención <b>{formatEuro(item.payroll.continuousDoubleMeal)}</b></span>}</div>
      {item.notes && <p className="jornal-notes">{item.notes}</p>}
      <div className="jornal-actions">{item.source === 'manual' ? <><button disabled={busy} onClick={() => onEdit(item)}>Editar jornal</button><button disabled={busy} onClick={() => onRemove(item.id)}>Eliminar</button></> : <button disabled={busy} onClick={() => onPremium(item)}>Editar prima</button>}</div>
    </div>
  </article>;
}

function Salary({ session, onSession }) {
  const [snapshot, setSnapshot] = useState(null);
  const [manualRows, setManualRows] = useState([]);
  const [premiums, setPremiums] = useState({});
  const [relayHours, setRelayHours] = useState({});
  const [remateHours, setRemateHours] = useState({});
  const [config, setConfig] = useState(null);
  const [month, setMonth] = useState('');
  const [period, setPeriod] = useState(() => new Date().getDate() <= 15 ? 'first' : 'second');
  const [form, setForm] = useState(blank);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('salary');
  const [irpf, setIrpf] = useState(Number(session.irpfRate) || 0);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [oldData, newRows, premiumData, rateData, relayData, remateData] = await Promise.all([
        rpc('app_cpe_get_saved_salary_history', { p_token: session.token }),
        rpc('app_cpe_list_manual_jornales', { p_token: session.token }),
        getUserManualPremiums({ token: session.token }), loadPayrollConfig(),
        getUserRelayHours({ token: session.token }), getUserRemateHours({ token: session.token })
      ]);
      setSnapshot(oldData); setManualRows(newRows || []); setPremiums(premiumData || {}); setConfig(rateData); setRelayHours(relayData || {}); setRemateHours(remateData || {});
    } catch (reason) { setError(reason.message || 'No se pudieron cargar los datos.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); if (!session.supportAccess) trackUsageEvent({ eventType: 'app_open', chapa: session.chapa }).catch(() => {}); }, [session.token]);
  useEffect(() => { if (!session.supportAccess) trackPageVisit({ token: session.token, page: tab === 'monitor' ? 'inicio' : 'sueldometro' }).catch(() => {}); }, [session.token, tab]);

  const months = useMemo(() => buildManualSalaryMonths(snapshot, manualRows, config, premiums, relayHours, remateHours), [snapshot, manualRows, config, premiums, relayHours, remateHours]);
  const currentMonthKey = today().slice(0, 7);
  const chosen = months.find((item) => item.key === month) || months.find((item) => item.key === currentMonthKey) || months[0];
  const selected = salaryPeriod(chosen?.items, period);
  const gross = selected.total;
  const net = Number((gross * (1 - irpf / 100)).toFixed(2));
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

  return <main className="manual-shell"><header className="app-header"><div className="brand"><img className="brand-logo" src={appLogo} alt="Centro Portuario de Empleo de Valencia" /><div><strong>Sueldómetro</strong><small>Registro manual</small></div></div><div className="header-actions"><span>Chapa {session.chapa}</span>{session.chapa === '72683' && <button className={tab === 'monitor' ? 'selected' : ''} onClick={() => setTab(tab === 'monitor' ? 'salary' : 'monitor')}>{tab === 'monitor' ? 'Sueldómetro' : 'Monitor'}</button>}<button onClick={() => { localStorage.removeItem(SESSION_KEY); onSession(null); }}>Salir</button></div></header>
    <div className="temporary-notice" role="note">{TEMPORARY_NOTICE}</div>
    {tab === 'monitor' ? <ActivityMonitor session={session} /> : <><section className="hero"><div><p className="eyebrow">TU REGISTRO PERSONAL</p><h1>Sueldómetro</h1><p>Consulta tu historial y añade jornales y primas a mano.</p></div><button className="primary" onClick={() => { setForm(blank()); setShowForm(true); setNotice(''); }}>+ Añadir jornal</button></section>
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
    {loading ? <section className="manual-panel"><p>Cargando tu historial…</p></section> : <>
      <section className="salary-top"><article className="salary-card lead"><small>Neto estimado · {period === 'month' ? 'mes completo' : period === 'first' ? '1.ª quincena' : '2.ª quincena'}</small><strong>{formatEuro(net)}</strong><span>IRPF {irpf}% · {selected.items.length} jornales</span></article><article className="salary-card"><small>Bruto estimado</small><strong>{formatEuro(gross)}</strong><span>{chosen?.label || 'Mes actual'}</span></article></section>
      <section className="manual-panel"><div className="section-head"><div><h2>Jornales</h2><p className="history-caption">Consulta la quincena actual o cualquier mes de tu historial.</p></div><div className="section-actions"><select aria-label="Mes del historial" value={chosen?.key || ''} onChange={(event) => setMonth(event.target.value)}>{months.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select><button onClick={load}>Actualizar</button></div></div>
        <div className="period-tabs" role="group" aria-label="Ver jornales por periodo">{[['first','1.ª quincena'],['second','2.ª quincena'],['month','Mes completo']].map(([key,label]) => <button key={key} type="button" className={period === key ? 'active' : ''} aria-pressed={period === key} onClick={() => setPeriod(key)}>{label}</button>)}</div>
        <div className="period-summary"><strong>{selected.items.length} {selected.items.length === 1 ? 'jornal' : 'jornales'}</strong><span>{chosen?.label || 'Mes actual'} · {period === 'first' ? 'días 1–15' : period === 'second' ? 'días 16–fin de mes' : 'mes completo'}</span></div>
        {!selected.items.length ? <div className="empty"><strong>No hay jornales en este periodo.</strong><p>Elige otra quincena o un mes del historial.</p></div> : <div className="journal-list">{selected.items.map((item, index) => <JornalCard key={`${item.source}-${item.id || item.payroll.manualPremiumKey}-${index}`} item={item} busy={busy} onEdit={edit} onRemove={remove} onPremium={editHistoricPremium} />)}</div>}
      </section><section className="manual-panel settings"><div><h2>Retención IRPF</h2><p>Se aplica a la estimación neta. No sustituye una nómina.</p></div><form onSubmit={saveIrpf}><input aria-label="Porcentaje de IRPF" type="number" min="0" max="60" step="0.01" value={irpf} onChange={(event) => setIrpf(Number(event.target.value))} /><span>%</span><button disabled={busy}>Guardar</button></form></section>
      <p className="footer-note">Los jornales históricos se conservan tal como estaban guardados. Los nuevos datos los introduces tú y solo pertenecen a tu cuenta.</p>
    </>}</>}
  </main>;
}

export function ManualApp() {
  const [session, setSession] = useState(readSession);
  return session ? <Salary session={session} onSession={setSession} /> : <Access onAccess={setSession} />;
}
