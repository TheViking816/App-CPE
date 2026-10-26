import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { supabase } from './supabaseClient.js';

export default function PortalCredentialPilot({ session }) {
  const [open, setOpen] = useState(false), [password, setPassword] = useState(''), [show, setShow] = useState(false);
  const [premiumKey, setPremiumKey] = useState(''), [showPremium, setShowPremium] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false), [pending, setPending] = useState(false);
  const [hasPassword, setHasPassword] = useState(false), [hasPremiumKey, setHasPremiumKey] = useState(false);
  const [keyOnly, setKeyOnly] = useState(false);
  const input = useRef(null), trigger = useRef(null), dialog = useRef(null);
  const enabled = Boolean(session.token);
  useEffect(() => {
    let active = true;
    if (enabled) supabase.rpc('app_cpe_portal_link_request_status', { p_token: session.token }).then(({data,error}) => {
      if (active && !error) { setPending(data?.status === 'pending'); setHasPassword(Boolean(data?.hasPortalPassword)); setHasPremiumKey(Boolean(data?.hasPremiumKey)); setKeyOnly(Boolean(data?.hasPortalPassword && !data?.hasPremiumKey)); }
    });
    return () => { active = false; };
  }, [enabled, session.token]);
  useEffect(() => {
    const openRequested = () => { if (sessionStorage.getItem('app-cpe-open-portal-link') === '1') { sessionStorage.removeItem('app-cpe-open-portal-link'); setOpen(true); setDone(false); setError(''); } };
    openRequested(); window.addEventListener('app-cpe-open-portal-link', openRequested);
    return () => window.removeEventListener('app-cpe-open-portal-link', openRequested);
  }, []);
  function close() { if (busy) return; setOpen(false); setPassword(''); setShow(false); setPremiumKey(''); setShowPremium(false); trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); if (!busy) close(); }
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
    event.preventDefault(); if ((keyOnly && !premiumKey.trim()) || (!keyOnly && !password) || busy) return;
    setBusy(true); setError('');
    try {
      const { data, error: rpcError } = keyOnly
        ? await supabase.rpc('app_cpe_save_portal_premium_key', { p_token: session.token, p_security_key: premiumKey.trim() })
        : await supabase.rpc('app_cpe_request_portal_links_with_premium', { p_token: session.token, p_portal_password: password, p_security_key: premiumKey.trim() || null });
      if (rpcError || !data) throw new Error('No se pudo guardar. Revisa tu sesión y vuelve a intentarlo en unos minutos.');
      setPending(data.status === 'pending'); setHasPassword(Boolean(data.hasPortalPassword)); setHasPremiumKey(Boolean(data.hasPremiumKey)); setDone(true);
    } catch (reason) { setError(reason.message || 'No se pudo guardar la contraseña.'); }
    finally { setPassword(''); setShow(false); setPremiumKey(''); setShowPremium(false); setBusy(false); }
  }
  return <>
    <section className="manual-panel manual-profile-settings portal-link-request-entry">
      <h2>Enlaces del portal</h2>
      {pending && <p>Enlaces pendientes de configuración.</p>}
      <button ref={trigger} type="button" className="primary" onClick={() => { setKeyOnly(hasPassword && !hasPremiumKey); setOpen(true); setDone(false); setError(''); }}>{hasPassword && !hasPremiumKey ? 'Guardar clave de primas' : hasPassword ? 'Actualizar contraseña del portal' : 'Vincular portal'}</button>
    </section>
    {open && <div className="portal-link-request-overlay" onMouseDown={event => { if (event.target===event.currentTarget) close(); }}>
      <section className="portal-link-request-modal" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="portal-link-request-title">
        <header><h2 id="portal-link-request-title">Vincular portal</h2><button type="button" onClick={close} disabled={busy} aria-label="Cerrar vinculación del portal"><X size={21} /></button></header>
        <div className="portal-link-request-body">
          {done ? <><p className="banner success" role="status">Datos guardados. Revisaremos los enlaces personales.</p><button type="button" className="primary" onClick={close}>Cerrar</button></> : <form onSubmit={submit}>
            {!keyOnly && <><label htmlFor="portal-request-password">Contraseña del portal</label>
            <div className="portal-pilot-password"><input ref={input} id="portal-request-password" type={show ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete="off" maxLength={256} required disabled={busy} />
              <button type="button" aria-label={show ? 'Ocultar contraseña del portal' : 'Mostrar contraseña del portal'} onClick={() => setShow(!show)} disabled={busy}>{show ? <EyeOff size={20} /> : <Eye size={20} />}</button></div></>}
            <label htmlFor="portal-request-premium-key">Clave de primas {keyOnly ? '' : '(opcional)'}</label>
            <div className="portal-pilot-password"><input ref={keyOnly ? input : undefined} id="portal-request-premium-key" type={showPremium ? 'text' : 'password'} value={premiumKey} onChange={event => setPremiumKey(event.target.value)} autoComplete="off" maxLength={256} required={keyOnly} disabled={busy} />
              <button type="button" aria-label={showPremium ? 'Ocultar clave de primas' : 'Mostrar clave de primas'} onClick={() => setShowPremium(!showPremium)} disabled={busy}>{showPremium ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary" disabled={busy || (keyOnly ? !premiumKey.trim() : !password)}>{busy ? 'Guardando…' : 'Guardar datos'}</button>
          </form>}
        </div>
      </section>
    </div>}
  </>;
}
