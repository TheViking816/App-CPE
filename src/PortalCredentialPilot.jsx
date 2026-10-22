import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { supabase } from './supabaseClient.js';

export default function PortalCredentialPilot({ session }) {
  const [open, setOpen] = useState(false), [password, setPassword] = useState(''), [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false), [pending, setPending] = useState(false);
  const input = useRef(null), trigger = useRef(null), dialog = useRef(null);
  const enabled = String(session.chapa) === '72683';
  useEffect(() => {
    let active = true;
    if (enabled) supabase.rpc('app_cpe_portal_link_request_status', { p_token: session.token }).then(({data,error}) => {
      if (active && !error) setPending(data?.status === 'pending');
    });
    return () => { active = false; };
  }, [enabled, session.token]);
  function close() { if (busy) return; setOpen(false); setPassword(''); setShow(false); trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); if (!busy) { setOpen(false); setPassword(''); setShow(false); trigger.current?.focus(); } }
      if (event.key === 'Tab') {
        const fields = [...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
        const first=fields[0], last=fields[fields.length-1];
        if (event.shiftKey && document.activeElement===first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement===last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown',onKey);
    return () => document.removeEventListener('keydown',onKey);
  }, [open,busy]);
  if (!enabled) return null;
  async function submit(event) {
    event.preventDefault(); if (!password || busy) return;
    setBusy(true); setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('app_cpe_request_portal_links', { p_token: session.token, p_portal_password: password });
      if (rpcError || data?.status !== 'pending') throw new Error('No se pudo guardar. Revisa tu sesión y vuelve a intentarlo en unos minutos.');
      setPending(true); setDone(true);
    } catch (reason) { setError(reason.message || 'No se pudo guardar la contraseña.'); }
    finally { setPassword(''); setShow(false); setBusy(false); }
  }
  return <>
    <section className="manual-panel manual-profile-settings portal-link-request-entry">
      <h2>Enlaces del portal</h2>
      {pending && <p>Enlaces pendientes de la próxima sincronización.</p>}
      <button ref={trigger} type="button" className="primary" onClick={() => { setOpen(true); setDone(false); setError(''); }}>{pending ? 'Actualizar contraseña del portal' : 'Vincular portal'}</button>
    </section>
    {open && <div className="portal-link-request-overlay" onMouseDown={event => { if (event.target===event.currentTarget) close(); }}>
      <section className="portal-link-request-modal" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="portal-link-request-title">
        <header><h2 id="portal-link-request-title">Vincular portal</h2><button type="button" onClick={close} disabled={busy} aria-label="Cerrar vinculación del portal"><X size={21} /></button></header>
        <div className="portal-link-request-body">
          {done ? <><p className="banner success" role="status">Tus enlaces personales se incorporarán en la próxima sincronización.</p><button type="button" className="primary" onClick={close}>Cerrar</button></> : <form onSubmit={submit}>
            <label htmlFor="portal-request-password">Contraseña del portal</label>
            <div className="portal-pilot-password"><input ref={input} id="portal-request-password" type={show ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete="off" maxLength={256} required disabled={busy} />
              <button type="button" aria-label={show ? 'Ocultar contraseña del portal' : 'Mostrar contraseña del portal'} onClick={() => setShow(!show)} disabled={busy}>{show ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary" disabled={busy || !password}>{busy ? 'Guardando…' : 'Leer enlaces'}</button>
          </form>}
        </div>
      </section>
    </div>}
  </>;
}
