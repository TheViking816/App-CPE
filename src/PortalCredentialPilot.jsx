import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from './supabaseClient.js';

export default function PortalCredentialPilot({ session }) {
  const [password, setPassword] = useState(''), [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  if (String(session.chapa) !== '72683') return null;
  async function submit(event) {
    event.preventDefault(); if (!password || busy) return;
    setBusy(true); setError(''); setDone(false);
    try {
      const bytes = new TextEncoder().encode(password);
      setPassword('');
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      bytes.fill(0);
      const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      const { data, error: rpcError } = await supabase.rpc('app_cpe_link_own_portal_pilot', { p_token: session.token, p_password_hash: hash });
      if (rpcError || !data?.linked) throw new Error('No se pudo vincular. Comprueba la contraseña del portal.');
      setDone(true);
    } catch (reason) { setError(reason.message || 'No se pudo comprobar el acceso.'); }
    finally { setPassword(''); setShow(false); setBusy(false); }
  }
  return <section className="manual-panel manual-profile-settings portal-credential-pilot">
    <h2>Vincular mi portal</h2>
    <p>Prueba para 72683 con tu acceso al portal ya verificado.</p>
    <form onSubmit={submit}>
      <label htmlFor="portal-pilot-password">Contraseña del portal</label>
      <div className="portal-pilot-password"><input id="portal-pilot-password" type={show ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete="off" maxLength={256} required disabled={busy} />
        <button type="button" className="secondary" aria-label={show ? 'Ocultar contraseña del portal' : 'Mostrar contraseña del portal'} onClick={() => setShow(!show)}>{show ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>
      <small>La contraseña se transforma en este dispositivo y se borra del campo. Se comprueba con tu enlace ya verificado, sin abrir otra sesión en el portal.</small>
      {error && <p className="form-error" role="alert">{error}</p>}
      {done && <p className="banner success" role="status">Portal vinculado. Tus accesos personales ya están disponibles.</p>}
      <button className="primary" disabled={busy || !password}>{busy ? 'Comprobando…' : 'Comprobar y vincular'}</button>
    </form>
  </section>;
}
