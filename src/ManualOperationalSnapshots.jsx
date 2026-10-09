import { useEffect, useMemo, useState } from 'react';
import { getLatestChaperoSnapshot, getLatestDoorSnapshots } from './supabaseClient.js';

const DOOR_SPECIALTIES = [
  'MAFIS', 'APOYO OPERACION', 'CONDUCTOR 1a', 'CONDUCTOR 2a',
  'CLASIFICADOR', 'TRASTAINERS RTT', 'CONTAINER', 'POL. CAPATAZ',
  'POL. SOBORDISTA', 'POL. ELEVADORAS', 'POL. CONDUCTOR 1a',
  'POL. CONDUCTOR 2a', 'POL. ESPECIALISTA', 'POL. TRINCADOR', 'POL. TRINCA COCHES'
];

function updatedAt(value) {
  return value ? new Date(value).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : 'sin datos';
}

export default function ManualOperationalSnapshots({ view, chapa }) {
  const [snapshots, setSnapshots] = useState([]);
  const [chapero, setChapero] = useState(null);
  const [selectedSpecialty, setSelectedSpecialty] = useState('CONDUCTOR 1a');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const load = view === 'puertas'
      ? getLatestDoorSnapshots(DOOR_SPECIALTIES).then((data) => active && setSnapshots(data))
      : getLatestChaperoSnapshot().then((data) => active && setChapero(data));
    load.finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [view]);

  const available = useMemo(() => [...snapshots].sort((a, b) => a.specialty.localeCompare(b.specialty, 'es')), [snapshots]);
  const selected = available.find((item) => item.specialty === selectedSpecialty) || available[0];
  const workers = (chapero?.workers || []).filter((item) => String(item.chapa).includes(query.trim()));

  if (view === 'puertas') {
    return <section className="manual-panel operational-panel">
      <div className="section-head"><div><p className="eyebrow">Operativa</p><h2>Puertas de turno</h2></div></div>
      {loading ? <p>Cargando Puertas…</p> : !selected ? <p>No hay datos de Puertas publicados.</p> : <>
        <p>Última lectura: {updatedAt(selected.updatedAt)}</p>
        <label>Especialidad <select value={selected.specialty} onChange={(event) => setSelectedSpecialty(event.target.value)}>
          {available.map((item) => <option key={item.specialty} value={item.specialty}>{item.specialty}</option>)}
        </select></label>
        <div className="table-wrap"><table><thead><tr><th>Turno</th><th>Puerta</th><th>Chapa</th></tr></thead><tbody>
          {selected.doors.map((door) => <tr key={door.key}><td>{door.label}</td><td>{door.raw || '—'}</td><td>{door.doorChapa || '—'}</td></tr>)}
        </tbody></table></div>
      </>}
    </section>;
  }

  const own = chapero?.workers.find((item) => String(item.chapa) === String(chapa));
  return <section className="manual-panel operational-panel">
    <div className="section-head"><div><p className="eyebrow">Operativa</p><h2>Chapero</h2></div></div>
    {loading ? <p>Cargando Chapero…</p> : !chapero ? <p>No hay datos de Chapero publicados.</p> : <>
      <p>{chapero.jornadaText || 'Jornada actual'} · Última lectura: {updatedAt(chapero.updatedAt)}</p>
      <p><strong>Tu estado:</strong> {own?.label || 'No figura en la lectura'}</p>
      <div className="operational-summary">{Object.entries(chapero.summary).map(([status, count]) => <span key={status}>{status}: <strong>{count}</strong></span>)}</div>
      <label>Buscar chapa <input value={query} onChange={(event) => setQuery(event.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Número de chapa" /></label>
      <div className="table-wrap"><table><thead><tr><th>Chapa</th><th>Estado</th></tr></thead><tbody>
        {workers.slice(0, query ? 100 : 50).map((worker) => <tr key={worker.chapa}><td>{worker.chapa}</td><td>{worker.label}</td></tr>)}
      </tbody></table></div>
      {!query && <small>Mostrando las primeras 50 chapas. Usa el buscador para localizar otra.</small>}
    </>}
  </section>;
}
