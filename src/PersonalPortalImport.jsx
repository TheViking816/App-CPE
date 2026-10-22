import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient.js';
import { parsePersonalPortalImport, PORTAL_LINK_SECTIONS } from './personalPortalImport.js';

async function call(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error('No se pudo guardar o consultar los enlaces. Revisa tu sesión y el texto pegado.');
  return data;
}

export default function PersonalPortalImport({ session }) {
  const [text, setText] = useState(''), [saved, setSaved] = useState([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const preview = useMemo(() => {
    if (!text.trim()) return {};
    try { return { data: parsePersonalPortalImport(text, session.chapa) }; }
    catch (reason) { return { error: reason.message }; }
  }, [text, session.chapa]);
  useEffect(() => {
    let active = true;
    if (String(session.chapa) === '72683') call('app_cpe_imported_portal_link_status', { p_token: session.token })
      .then(value => { if (active) setSaved(value || []); }).catch(() => { if (active) setError('No se pudieron consultar los enlaces guardados.'); });
    return () => { active = false; };
  }, [session.token, session.chapa]);
  if (String(session.chapa) !== '72683') return null;
  async function submit(event) {
    event.preventDefault(); if (!preview.data || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const status = await call('app_cpe_import_personal_portal_links', { p_token: session.token, p_payload: preview.data });
      setSaved(status || []); setText(''); setNotice('Enlaces guardados. Ya se usarán al abrir esas secciones.');
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  return <section className="manual-panel manual-profile-settings personal-link-import">
    <h2>Importar enlaces del portal</h2>
    <p>Pega el resultado de «Capturar enlace CPE». Prueba privada para tu chapa 72683.</p>
    <form onSubmit={submit}>
      <label htmlFor="personal-link-paste">Resultado del marcador</label>
      <textarea id="personal-link-paste" value={text} onChange={event => { setText(event.target.value); setNotice(''); setError(''); }} rows={5} maxLength={40000} autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="Pega aquí el JSON del marcador" />
      {preview.data && <p role="status">Se guardará: {preview.data.enlaces.map(link => PORTAL_LINK_SECTIONS[link.seccion.slice(1)]).join(', ')}.</p>}
      {(preview.error || error) && <p className="form-error" role="alert">{preview.error || error}</p>}
      {notice && <p className="banner success" role="status">{notice}</p>}
      <button className="primary" disabled={busy || !preview.data}>{busy ? 'Guardando…' : 'Guardar enlaces'}</button>
    </form>
    {saved.length > 0 && <div><h3>Enlaces guardados</h3><ul>{saved.map(link => <li key={link.section}>{PORTAL_LINK_SECTIONS[link.section] || link.section}</li>)}</ul></div>}
  </section>;
}
