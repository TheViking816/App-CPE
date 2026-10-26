import React, { useEffect, useRef, useState } from 'react';
import { Building2, CalendarClock, ChevronRight, ClipboardList, Clock3, Ship, Upload, Users, X } from 'lucide-react';
import { supabase } from './supabaseClient.js';
import { companyLogo, shipImage } from './generalBoard.js';
import { assignmentDateKey, assignmentKey, assignmentShift, madridDateKey, upcomingAssignments, validateUpcomingReading } from './upcomingAssignments.js';
import './upcomingAssignments.css';

const storageKey = 'app-cpe-upcoming-preview-72683-v1';
const clean = (value) => /^-*$/.test(String(value || '').trim()) ? '' : String(value || '').trim();
const dateLabel = (date, options = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat('es-ES', { ...options, timeZone: 'Europe/Madrid' }).format(new Date(`${assignmentDateKey(date)}T12:00:00Z`));
function savedReading() {
  try { const value = localStorage.getItem(storageKey); return value ? validateUpcomingReading(JSON.parse(value)) : null; }
  catch { return null; }
}

export default function UpcomingAssignments({ session, snapshot }) {
  const [reading, setReading] = useState(savedReading);
  const [archive, setArchive] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState('');
  const fileInput = useRef(null);
  const [today, setToday] = useState(madridDateKey);
  useEffect(() => {
    const interval = setInterval(() => setToday(madridDateKey()), 60_000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    let active = true;
    supabase?.rpc('app_cpe_get_portal_snapshot', { p_token: session.token }).then(({ data, error: failure }) => {
      if (active && !failure && String(data?.chapa) === '72683') setArchive(data);
    });
    return () => { active = false; };
  }, [session.token]);
  const combined = { ...snapshot, payload: { ...snapshot?.payload, asignaciones: archive?.payload?.asignaciones } };
  const rows = upcomingAssignments({ snapshot: combined, reading, today });
  const archived = [...(archive?.payload?.asignaciones?.rows || [])].filter((item) => item.detail?.specialties?.length && assignmentDateKey(item.fecha) < today).sort((a, b) => assignmentDateKey(b.fecha).localeCompare(assignmentDateKey(a.fecha)));
  const example = archived.find((row) => clean(row.buque || row.detail?.buque)) || archived[0];
  const importReading = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('El archivo de lectura es demasiado grande.');
      const value = validateUpcomingReading(JSON.parse(await file.text()));
      localStorage.setItem(storageKey, JSON.stringify(value)); setReading(value); setError('');
    } catch (reason) { setError(reason.message || 'No se pudo cargar la lectura.'); }
  };
  const open = async (item, historical = false) => {
    setError(''); setOpening(assignmentKey(item));
    let detail = item.detail;
    try {
      if (!detail?.specialties?.length) {
        const { data, error: failure } = await supabase.rpc('app_cpe_get_shared_part_detail', {
          p_parte: String(item.parte), p_fecha: assignmentDateKey(item.fecha), p_jornada: assignmentShift(item.jornada)
        });
        if (failure) throw failure;
        detail = data?.detail;
      }
    } catch { /* Keep the saved journal visible even when no part detail is available. */ }
    setOpening(''); setSelected({ ...item, detail, historical });
  };
  return <section className="upcoming-preview" aria-label="Próximas contrataciones">
    <header className="upcoming-heading"><span className="upcoming-heading-icon"><CalendarClock size={23} /></span><div><small>MI CONTRATACIÓN</small><h2>Próximas contrataciones</h2></div><span className="upcoming-count">{rows.length} {rows.length === 1 ? 'jornal' : 'jornales'}</span></header>
    {rows.length ? <div className="upcoming-list">{rows.map((item) => <button type="button" className="upcoming-row" key={assignmentKey(item)} onClick={() => open(item)} disabled={opening === assignmentKey(item)}>
      <span className="upcoming-date"><small>{item.fecha === today ? 'HOY' : dateLabel(item.fecha, { weekday: 'short' })}</small><strong>{dateLabel(item.fecha, { day: 'numeric' })}</strong><span>{dateLabel(item.fecha, { month: 'short' })}</span></span>
      <span className="upcoming-company">{companyLogo(item.empresa) ? <img src={companyLogo(item.empresa)} alt="" /> : <Building2 size={25} />}</span>
      <span className="upcoming-copy"><strong>{item.especialidad || 'Jornal contratado'}</strong><span>{[clean(item.buque), clean(item.empresa)].filter(Boolean).join(' · ')}</span><small>{clean(item.operacion)}</small><span className="upcoming-row-meta"><b><Clock3 size={13} />{item.jornada}</b><b>Parte {item.parte}</b>{item.anticipada && <b>Anticipada</b>}</span></span><ChevronRight size={19} />
    </button>)}</div> : <div className="upcoming-empty"><ClipboardList size={29} /><div><strong>No hay próximos jornales en la lectura guardada</strong><span>Aparecerán aquí las contrataciones de hoy y de los días siguientes.</span></div></div>}
    <footer className="upcoming-preview-tools"><span>{reading?.updatedAt ? `Lectura de prueba · ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(reading.updatedAt))}` : 'Prueba privada · 72683'}</span><div>{example && <button type="button" onClick={() => open(example, true)}>Ver parte guardado de ejemplo</button>}<button type="button" onClick={() => fileInput.current?.click()}><Upload size={14} /> Cargar lectura de prueba</button><input ref={fileInput} type="file" accept="application/json,.json" onChange={importReading} hidden /></div></footer>
    {error && <p className="form-error" role="alert">{error}</p>}
    {selected && <AssignmentModal item={selected} onClose={() => setSelected(null)} />}
  </section>;
}

function AssignmentModal({ item, onClose }) {
  const close = useRef(null);
  const groups = item.detail?.specialties || [];
  const detail = { ...item, ...item.detail };
  const shipName = clean(detail.buque), photo = shipImage(shipName);
  const [imageFailed, setImageFailed] = useState(false);
  const workers = groups.reduce((sum, group) => sum + (group.workers?.length || 0), 0);
  useEffect(() => {
    const previous = document.body.style.overflow;
    const focused = document.activeElement;
    document.body.style.overflow = 'hidden'; close.current?.focus();
    const keyboard = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const elements = [...close.current.closest('[role="dialog"]').querySelectorAll('button,[href],input,select,textarea,[tabindex="0"]')];
        if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', keyboard); focused?.focus(); };
  }, []);
  return <div className="upcoming-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="upcoming-part-modal" role="dialog" aria-modal="true" aria-labelledby="upcoming-part-title">
    <header><span className="upcoming-modal-logo">{companyLogo(detail.empresa) ? <img src={companyLogo(detail.empresa)} alt="" /> : <Building2 size={25} />}</span><div><small>{item.historical ? 'PARTE GUARDADO · EJEMPLO DEL HISTORIAL' : 'MI CONTRATACIÓN'} · Parte {item.parte}</small><h2 id="upcoming-part-title">{shipName || detail.empresa || 'Jornal contratado'}</h2><span>{detail.empresa}</span></div><button ref={close} type="button" onClick={onClose} aria-label="Cerrar parte"><X size={21} /></button></header>
    <div className="upcoming-modal-content">
      {photo && !imageFailed && <figure className="upcoming-ship"><img src={photo} alt={`Buque ${shipName}`} onError={() => setImageFailed(true)} /><figcaption><Ship size={16} />{shipName}</figcaption></figure>}
      <dl className="upcoming-part-facts"><div><dt>Fecha</dt><dd>{dateLabel(item.fecha, { day: 'numeric', month: 'long', year: 'numeric' })}</dd></div><div><dt>Jornada</dt><dd>{assignmentShift(item.jornada)}</dd></div><div><dt>Operación</dt><dd>{detail.operacion || '—'}</dd></div><div><dt>Muelle</dt><dd>{detail.muelle || '—'}</dd></div></dl>
      <div className="upcoming-team-title"><h3><Users size={19} />Equipo del parte</h3><span>{workers} trabajadores</span></div>
      {!groups.length && <p className="upcoming-team-empty">El detalle del equipo todavía no está guardado en esta prueba.</p>}
      <div className="upcoming-team">{groups.map((group, index) => <section key={`${group.name}-${index}`}><header><h4>{group.name}</h4><span>{group.workers?.length || 0}{Number(group.requested) > (group.workers?.length || 0) ? ` / ${group.requested}` : ''}</span></header><ul>{(group.workers || []).map((worker, i) => <li key={`${worker.code}-${i}`} className={String(worker.code).replace(/\D/g, '') === '72683' ? 'is-me' : ''}><b>{worker.code}</b><span>{worker.name || '—'}</span>{String(worker.code).replace(/\D/g, '') === '72683' && <em>Tú</em>}</li>)}</ul></section>)}</div>
      {clean(detail.observaciones) && <p className="upcoming-part-observations">{detail.observaciones}</p>}
    </div>
  </section></div>;
}
