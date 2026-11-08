import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';
import './passwordRecovery.css';

async function recoveryRequest(body) {
  if (!supabase) throw new Error('No se pudo conectar con el servidor.');
  const { data, error } = await supabase.functions.invoke('app-cpe-password-recovery', { body });
  if (error || !data?.ok) {
    let message = data?.message;
    if (!message && error?.context) {
      try { message = (await error.context.json()).message; } catch { /* Network failure. */ }
    }
    throw new Error(message || 'No se pudo procesar la solicitud. Vuelve a intentarlo.');
  }
  return data;
}

export function PasswordRecovery({ initialChapa = '', token = null, onBack }) {
  const [chapa, setChapa] = useState(initialChapa);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const resetting = token !== null;
  async function submit(event) {
    event.preventDefault(); setError('');
    if (resetting && password !== confirmation) { setError('Las contraseñas no coinciden.'); return; }
    if (resetting && (password.length < 8 || new TextEncoder().encode(password).length > 72)) {
      setError('Usa al menos 8 caracteres y un máximo de 72 bytes.'); return;
    }
    setBusy(true);
    try {
      await recoveryRequest(resetting ? { action: 'reset', token, password } : { action: 'request', chapa: chapa.trim() });
      setSent(true); setPassword(''); setConfirmation('');
      if (resetting) {
        localStorage.removeItem('app-cpe-session');
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/recuperar`);
      }
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  return <main className="manual-shell access-shell"><section className="access-card recovery-card">
    <img className="brand-logo access-logo" src={`${import.meta.env.BASE_URL}logo.jpg`} alt="App CPE" />
    <h1>{resetting ? 'Nueva contraseña' : 'Recuperar contraseña'}</h1>
    {sent ? <p role="status">{resetting
      ? 'Tu contraseña se ha actualizado. Ya puedes entrar con la nueva contraseña.'
      : 'Si tu chapa tiene un correo asociado, recibirás un enlace válido durante una hora. Revisa también la carpeta de spam.'}</p>
      : <form onSubmit={submit}>
        {resetting ? <>
          <p>Elige una contraseña exclusiva de App CPE.</p>
          <label>Nueva contraseña<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>Repite la contraseña<input type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        </> : <>
          <p>Te enviaremos un enlace al correo asociado a tu cuenta.</p>
          <label>Chapa<input inputMode="numeric" autoComplete="username" pattern="[0-9]{1,5}" maxLength={5} required value={chapa} onChange={(event) => setChapa(event.target.value.replace(/\D/g, '').slice(0, 5))} /></label>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary" disabled={busy || (resetting && !/^[a-f0-9]{64}$/.test(token))}>{busy ? 'Un momento…' : resetting ? 'Guardar contraseña' : 'Enviar enlace'}</button>
        {resetting && !/^[a-f0-9]{64}$/.test(token) && <p role="alert">El enlace no es válido. Solicita uno nuevo desde el login.</p>}
      </form>}
    <button className="text-button" type="button" disabled={busy} onClick={onBack}>Volver a entrar</button>
    {!resetting && <small>¿No tienes correo asociado o no puedes acceder a él? Contacta con <a href="mailto:portalestibavlc@gmail.com">portalestibavlc@gmail.com</a>.</small>}
  </section></main>;
}

export function RecoveryEmailSettings({ session, onSession }) {
  const [email, setEmail] = useState(session.email || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const { data, error: rpcError } = await supabase.rpc('app_cpe_set_recovery_email', { p_token: session.token, p_password: password, p_email: email.trim() });
      if (rpcError) throw rpcError;
      const next = { ...session, ...data };
      localStorage.setItem('app-cpe-session', JSON.stringify(next)); onSession(next);
      setPassword(''); setNotice('Correo de recuperación guardado.');
    } catch (reason) { setError(reason.message || 'No se pudo guardar el correo.'); }
    finally { setBusy(false); }
  }
  return <section className="manual-panel manual-profile-settings">
    <h2>Correo de recuperación</h2><p>Se usará para recuperar tu contraseña. Comprueba que tienes acceso a este correo.</p>
    <form onSubmit={save}>
      <label>Correo electrónico<input type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Contraseña actual<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="banner success" role="status">{notice}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar correo'}</button>
    </form>
  </section>;
}

export function PasswordRecoveryRoot({ children }) {
  const readToken = () => /^#\/recuperar(?:\?|$)/.test(window.location.hash)
    ? new URLSearchParams(window.location.hash.split('?')[1]).get('token') || '' : null;
  const [token, setToken] = useState(readToken);
  useEffect(() => {
    const update = () => setToken(readToken());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return token === null ? children : <PasswordRecovery token={token} onBack={() => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/sueldometro`);
    window.location.reload();
  }} />;
}
