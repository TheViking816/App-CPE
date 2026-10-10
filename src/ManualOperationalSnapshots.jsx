import { useEffect, useMemo, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { classifyDistance, findByChapa, getDoorState, specialties } from './censo.js';
import { getLatestChaperoSnapshot, getLatestDoorSnapshots, updateUserSpecialties } from './supabaseClient.js';
import PersonalNoraySectionLink from './PersonalNoraySectionLink.jsx';

const DOOR_SPECIALTIES = [
  'MAFIS', 'APOYO OPERACION', 'CONDUCTOR 1a', 'CONDUCTOR 2a',
  'CLASIFICADOR', 'TRASTAINERS RTT', 'CONTAINER', 'POL. CAPATAZ',
  'POL. SOBORDISTA', 'POL. ELEVADORAS', 'POL. CONDUCTOR 1a',
  'POL. CONDUCTOR 2a', 'POL. ESPECIALISTA', 'POL. TRINCADOR', 'POL. TRINCA COCHES'
];
const formatDate = (value) => value
  ? new Date(value).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
  : 'Sin actualizar';
const formatDistance = (value) => value == null ? 'Sin dato' : value === 0 ? 'En puerta' : `${value} posiciones`;

function DoorTable({ title, doors, tone }) {
  return <section className="doors-table-section">
    <h2>{title}</h2><div className="doors-table-wrap"><table className="doors-table">
      <thead><tr><th>TIPO</th><th>POS.</th><th>CHAPA</th><th>DIST.</th></tr></thead>
      <tbody>{doors.map((door) => <tr key={door.key} className={classifyDistance(door.distance)}>
        <td><strong>{door.label}</strong><small>{door.shift}</small></td>
        <td><span className={`door-badge ${tone}`}>{door.doorPosition || '-'}</span></td>
        <td>{door.doorChapa || '-'}</td><td>{formatDistance(door.distance)}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}

function DoorRings({ doors, user, total }) {
  return <section className="door-rings-grid" aria-label="Distancia visual a puertas">
    {doors.map((door) => <article key={door.key} className={`door-ring-card ${classifyDistance(door.distance)}`}>
      <div className="mini-position-ring" style={{
        '--user-angle': `${user?.position && total ? user.position / total * 360 : 0}deg`,
        '--door-angle': `${door.doorPosition && total ? door.doorPosition / total * 360 : 0}deg`
      }} aria-hidden="true"><span className="ring-dot user-dot" /><span className="ring-dot door-dot" /><strong>{door.distance ?? '--'}</strong></div>
      <div><span>{door.dayType === 'festivo' ? 'Festiva' : 'Laborable'}</span><strong>{door.label}</strong><small>{door.doorChapa || door.raw || '-'}</small></div>
    </article>)}
  </section>;
}

function initialSpecialtyIds(session) {
  const known = new Set(specialties.map((item) => item.id));
  const saved = (session.specialties || []).filter((id) => known.has(id));
  if (saved.length) return saved;
  return specialties.filter((item) => findByChapa(session.chapa, item.id)).map((item) => item.id).slice(0, 1);
}

export default function ManualOperationalSnapshots({ view, session, onSession }) {
  const chapa = session.chapa;
  const [snapshots, setSnapshots] = useState([]);
  const [chapero, setChapero] = useState(null);
  const [savedIds, setSavedIds] = useState(() => initialSpecialtyIds(session));
  const [draftIds, setDraftIds] = useState(savedIds);
  const [selectedId, setSelectedId] = useState(savedIds[0] || specialties[0].id);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [censusQuery, setCensusQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const load = view === 'puertas'
      ? getLatestDoorSnapshots(DOOR_SPECIALTIES).then((data) => { if (active) setSnapshots(data); })
      : Promise.all([getLatestDoorSnapshots(DOOR_SPECIALTIES), getLatestChaperoSnapshot()])
        .then(([doors, status]) => { if (active) { setSnapshots(doors); setChapero(status); } });
    load.finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [view]);

  const available = useMemo(() => specialties.filter((item) => savedIds.includes(item.id)), [savedIds]);
  const specialty = available.find((item) => item.id === selectedId) || available[0];
  const snapshot = snapshots.find((item) => item.specialty === specialty?.name);
  const doors = specialty ? getDoorState(chapa, snapshot?.doors || [], specialty.id) : [];
  const user = specialty ? findByChapa(chapa, specialty.id) : null;
  const chaperoWorker = chapero?.workers.find((item) => String(item.chapa) === String(chapa));
  const censusRows = (specialty?.censo || []).filter((item) => String(item.chapa).includes(censusQuery.trim()));
  const toggleSpecialty = (id) => setDraftIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const saveSpecialties = async () => {
    if (!draftIds.length) { setMessage('Selecciona al menos una especialidad.'); return; }
    setSaving(true); setMessage('');
    try {
      const response = await updateUserSpecialties({ token: session.token, specialties: draftIds });
      if (!response) throw new Error('No hay conexión para guardar las especialidades.');
      const next = { ...session, ...response, specialties: draftIds };
      localStorage.setItem('app-cpe-session', JSON.stringify(next));
      onSession(next);
      setSavedIds(draftIds);
      if (!draftIds.includes(selectedId)) setSelectedId(draftIds[0]);
      setMessage('Especialidades guardadas.');
    } catch (error) {
      setMessage(error.message || 'No se pudieron guardar las especialidades.');
    } finally { setSaving(false); }
  };
  const selector = <div className="specialty-select doors-specialty-select">
    <span>Especialidad</span><select aria-label="Seleccionar puertas por especialidad" value={specialty?.id || ''} onChange={(event) => setSelectedId(event.target.value)}>
      {available.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  </div>;
  const census = <details className="operational-census">
    <summary>Censo de {specialty?.name || 'especialidad'} · {specialty?.censo.length || 0} trabajadores</summary>
    <label>Buscar chapa <input value={censusQuery} onChange={(event) => setCensusQuery(event.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Número de chapa" /></label>
    <div className="operational-census-list">{censusRows.slice(0, 100).map((item) =>
      <div key={item.chapa} className={item.chapa === chapa ? 'is-self' : ''}><strong>{item.displayPosition || item.position}</strong><span>{item.chapa}</span></div>)}</div>
    {censusRows.length > 100 && <small>Mostrando 100 de {censusRows.length}. Busca una chapa para localizarla.</small>}
  </details>;

  if (view === 'puertas') return <section className="operational-panel">
    <section className="visual-page-heading"><div><span>PUERTAS DE TURNO</span><h1>Puertas</h1></div></section>
    <PersonalNoraySectionLink session={session} section="puertas" label="Abrir mis puertas" />
    {selector}
    <div className="operational-context"><strong>{specialty?.name || 'Sin datos'}</strong><span>Censo: {specialty?.censo.length || 0} · Actualizado: {formatDate(snapshot?.updatedAt)}</span></div>
    {loading ? <p>Cargando Puertas…</p> : !doors.length ? <p>No hay puertas publicadas para esta especialidad.</p> : <>
      <DoorTable title="Laborables" doors={doors.filter((door) => door.dayType === 'laborable')} tone="lab" />
      <DoorTable title="Festivas" doors={doors.filter((door) => door.dayType === 'festivo')} tone="fes" />
    </>}
    {census}
  </section>;

  const statusLabels = { contratado: 'Contratado', anticipado: 'Anticipado', nocontratado: 'No contratado', falta: 'No disponible', excepcion: 'Con excepción', doble: 'Doble' };
  return <section className="operational-panel">
    <section className="visual-page-heading"><div><span>ESTADO Y POSICIÓN</span><h1>Chapero</h1></div></section>
    <PersonalNoraySectionLink session={session} section="chapero" label="Abrir mi chapero" />
    <section className={`chapero-card ${loading ? 'loading' : chaperoWorker?.status || 'empty'}`}>
      <div className="jornada-card"><span>Última jornada contratada</span><strong>{chapero?.jornadaDate && chapero?.fromHour ? `${chapero.jornadaDate} ${chapero.fromHour}-${chapero.toHour}` : 'Sin jornada'}</strong></div>
      <div className="chapero-meta-row"><span>{new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</span><small>Chapa {chapa}</small></div>
      <div className="chapero-status-row"><div className="chapero-status-copy"><span>Estado:</span><strong>{loading ? 'Cargando...' : statusLabels[chaperoWorker?.status] || 'No encontrado'}</strong></div></div>
      <div className="chapero-summary">
        {[["contratado", "Contr."], ["anticipado", "Ant."], ["nocontratado", "No cont."], ["falta", "N.D."]].map(([key, label]) =>
          <div key={key}><strong>{chapero?.summary?.[key] ?? '-'}</strong><span>{label}</span></div>)}
      </div>
      <div className="chapero-updated"><Clock3 size={14} /><span>Actualizado: {formatDate(chapero?.updatedAt)}</span></div>
    </section>
    <details className="operational-specialties">
      <summary>Añadir especialidades · {draftIds.length} seleccionadas</summary>
      <p>Marca todas las especialidades y polivalencias que quieras consultar.</p>
      <div className="operational-specialty-list">{specialties.map((item) =>
        <label key={item.id}><input type="checkbox" checked={draftIds.includes(item.id)} onChange={() => toggleSpecialty(item.id)} /><span>{item.name}</span><small>{item.kind === 'polivalencia' ? 'Polivalencia' : 'Especialidad'}</small></label>)}</div>
      <button type="button" disabled={saving} onClick={saveSpecialties}>{saving ? 'Guardando…' : 'Guardar especialidades'}</button>
      {message && <p role="status">{message}</p>}
    </details>
    {selector}
    <div className="home-summary"><div><p>Tu posición</p><h1>{user?.displayPosition || user?.position || '-'} / {specialty?.censo.length || 0}</h1><span>Chapa {chapa}</span></div></div>
    <DoorRings user={user} doors={doors} total={specialty?.censo.length || 0} />
    {census}
  </section>;
}
