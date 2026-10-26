import React, { useEffect, useRef, useState } from 'react';
import { Building2, CalendarClock, ChevronRight, ClipboardList, Clock3, Ship, Users, X } from 'lucide-react';
import { supabase } from './supabaseClient.js';
import { companyLogo, shipImage } from './generalBoard.js';
import { assignmentDateKey, assignmentKey, assignmentShift, madridDateKey, upcomingAssignments, validateUpcomingReading, UPCOMING_PREVIEW_CHANNEL } from './upcomingAssignments.js';
import './upcomingAssignments.css';

const assignmentCompanyLogo = (name) => {
  if (/\bTCV\b|TERMINAL.*CONTENEDORES.*VALENCIA/i.test(String(name || ''))) return `${import.meta.env.BASE_URL}assets/empresas/tcv.svg`;
  const logo = companyLogo(name), filename = logo.split('/').pop();
  return ['apm.jpeg', 'csp.jpeg', 'msc.jpeg', 'cpe.jpg', 'vteu.jpeg'].includes(filename)
    ? `${import.meta.env.BASE_URL}assets/empresas/${filename}` : logo;
};
const clean = (value) => /^-*$/.test(String(value || '').trim()) ? '' : String(value || '').trim();
const dateLabel = (date, options = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat('es-ES', { ...options, timeZone: 'Europe/Madrid' }).format(new Date(`${assignmentDateKey(date)}T12:00:00Z`));
export default function UpcomingAssignments({ session, snapshot }) {
  const [reading, setReading] = useState(null);
  const [archive, setArchive] = useState(null);
  const [selected, setSelected] = useState(null);
  const [opening, setOpening] = useState('');
  const [today, setToday] = useState(madridDateKey);
  useEffect(() => {
    const interval = setInterval(() => setToday(madridDateKey()), 60_000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!supabase) return;
      const [saved, preview] = await Promise.all([
        supabase.rpc('app_cpe_get_portal_snapshot', { p_token: session.token }),
        supabase.rpc('app_cpe_get_portal_preview_snapshot', { p_token: session.token, p_channel: UPCOMING_PREVIEW_CHANNEL })
      ]);
      if (!active) return;
      if (!saved.error && String(saved.data?.chapa) === String(session.chapa)) setArchive(saved.data);
      if (!preview.error && String(preview.data?.chapa) === String(session.chapa) && preview.data?.payload?.upcomingAssignments) {
        setReading(validateUpcomingReading(preview.data.payload.upcomingAssignments, session.chapa));
      }
    };
    refresh().catch(() => {});
    const interval = setInterval(() => { if (document.visibilityState === 'visible') refresh().catch(() => {}); }, 60_000);
    return () => { active = false; clearInterval(interval); };
  }, [session.token]);
  const combined = { ...snapshot, payload: { ...snapshot?.payload, asignaciones: archive?.payload?.asignaciones } };
  const rows = upcomingAssignments({ snapshot: combined, reading, today });
  const open = async (item) => {
    setOpening(assignmentKey(item));
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
    setOpening(''); setSelected({ ...item, detail });
  };
  return <div className="contracting-journals"><section className="upcoming-preview" aria-label="Próximas contrataciones">
    <header className="upcoming-heading"><span className="upcoming-heading-icon"><CalendarClock size={23} /></span><div><h2>Próximos jornales</h2></div><span className="upcoming-count">{rows.length} {rows.length === 1 ? 'jornal' : 'jornales'}</span></header>
    {rows.length ? <div className="upcoming-list">{rows.map((item) => <AssignmentRow key={assignmentKey(item)} item={item} today={today} busy={opening === assignmentKey(item)} onOpen={open} />)}</div> : <div className="upcoming-empty"><ClipboardList size={29} /><div><strong>Sin próximas contrataciones</strong><span>No tienes jornales guardados para hoy ni para los días siguientes.</span></div></div>}
    {reading?.updatedAt && Number.isFinite(Date.parse(reading.updatedAt)) && <footer className="upcoming-updated">Actualizado · {new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(reading.updatedAt))}</footer>}
  </section>
    {selected && <AssignmentModal item={selected} chapa={session.chapa} onClose={() => setSelected(null)} />}
  </div>;
}

function AssignmentRow({ item, today, busy, onOpen }) {
  return <button type="button" className="upcoming-row" onClick={() => onOpen(item)} disabled={busy}>
    <span className="upcoming-date"><small>{item.fecha === today ? 'HOY' : dateLabel(item.fecha, { weekday: 'short' })}</small><strong>{dateLabel(item.fecha, { day: 'numeric' })}</strong><span>{dateLabel(item.fecha, { month: 'short' })}</span></span>
    <span className="upcoming-company">{assignmentCompanyLogo(item.empresa) ? <img src={assignmentCompanyLogo(item.empresa)} alt="" /> : <Building2 size={25} />}</span>
    <span className="upcoming-copy"><strong>{item.especialidad || 'Jornal contratado'}</strong><span>{[clean(item.buque), clean(item.empresa)].filter(Boolean).join(' · ')}</span><small>{clean(item.operacion)}</small><span className="upcoming-row-meta"><b><Clock3 size={13} />{assignmentShift(item.jornada)}</b><b>Parte {item.parte}</b>{item.anticipada && <b>Anticipada</b>}</span></span><ChevronRight size={19} />
  </button>;
}

function AssignmentModal({ item, chapa, onClose }) {
  const close = useRef(null);
  const groups = item.detail?.specialties || [];
  const detail = { ...item, ...item.detail };
  const shipName = clean(detail.buque), photo = shipImage(shipName);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageReady, setImageReady] = useState(false);
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
    <header><span className="upcoming-modal-logo">{assignmentCompanyLogo(detail.empresa) ? <img src={assignmentCompanyLogo(detail.empresa)} alt="" /> : <Building2 size={25} />}</span><div><small>MI CONTRATACIÓN · Parte {item.parte}</small><h2 id="upcoming-part-title">{shipName || detail.empresa || 'Jornal contratado'}</h2><span>{detail.empresa}</span></div><button ref={close} type="button" onClick={onClose} aria-label="Cerrar parte"><X size={21} /></button></header>
    <div className="upcoming-modal-content">
      {photo && !imageFailed && <figure className="upcoming-ship" hidden={!imageReady}><img src={photo} alt={`Buque ${shipName}`} onLoad={() => setImageReady(true)} onError={() => setImageFailed(true)} /><figcaption><Ship size={16} />{shipName}</figcaption></figure>}
      <dl className="upcoming-part-facts"><div><dt>Fecha</dt><dd>{dateLabel(item.fecha, { day: 'numeric', month: 'long', year: 'numeric' })}</dd></div><div><dt>Jornada</dt><dd>{assignmentShift(item.jornada)}</dd></div><div><dt>Operación</dt><dd>{detail.operacion || '—'}</dd></div><div><dt>Muelle</dt><dd>{detail.muelle || '—'}</dd></div></dl>
      <div className="upcoming-team-title"><h3><Users size={19} />Equipo del parte</h3><span>{workers} trabajadores</span></div>
      {!groups.length && <p className="upcoming-team-empty">El equipo de este parte todavía no está disponible.</p>}
      <div className="upcoming-team">{groups.map((group, index) => <section key={`${group.name}-${index}`}><header><h4>{group.name}</h4><span>{group.workers?.length || 0}{Number(group.requested) > (group.workers?.length || 0) ? ` / ${group.requested}` : ''}</span></header><ul>{(group.workers || []).map((worker, i) => <li key={`${worker.code}-${i}`} className={String(worker.code).replace(/\D/g, '') === String(chapa) ? 'is-me' : ''}><b>{worker.code}</b><span>{worker.name || '—'}</span>{String(worker.code).replace(/\D/g, '') === String(chapa) && <em>Tú</em>}</li>)}</ul></section>)}</div>
      {clean(detail.observaciones) && <p className="upcoming-part-observations">{detail.observaciones}</p>}
    </div>
  </section></div>;
}
