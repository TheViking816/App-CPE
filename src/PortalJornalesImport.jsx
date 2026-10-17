import React, { useMemo, useState } from 'react';
import { ClipboardPaste, Eye, X } from 'lucide-react';
import { parsePortalJornalesPaste, planPortalJornalesImport } from './portalJornalesPaste.js';

export default function PortalJornalesImport({ existingItems, manualRows, busy, onImport, onClose }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try { return parsePortalJornalesPaste(text); }
    catch (reason) { return { rows: [], errors: [reason.message], monthKey: '', premiumsHidden: false, premiumsPending: 0 }; }
  }, [text]);
  const plan = useMemo(() => parsed?.rows?.length ? planPortalJornalesImport(parsed, existingItems, manualRows) : null,
    [parsed, existingItems, manualRows]);
  const ready = parsed && parsed.errors.length === 0 && plan && plan.conflicts.length === 0 && plan.actions.length > 0;

  async function submit(event) {
    event.preventDefault();
    if (!ready || busy) return;
    setError('');
    try { await onImport(parsed, plan); }
    catch (reason) { setError(reason.message || 'No se pudieron importar los jornales.'); }
  }

  return <section className="manual-panel portal-paste-import" aria-labelledby="portal-paste-title">
    <div className="section-head"><div><small>Jornales y primas</small><h2 id="portal-paste-title">Importar jornales</h2></div><button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar importación"><X size={18} /></button></div>
    <div className="portal-paste-body">
      <ol className="portal-paste-steps">
        <li>Abre <strong>Jornales y primas</strong> en el portal y elige un mes.</li>
        <li>Si quieres importar las primas, pulsa el <Eye size={16} aria-label="ojo" /> ojo e introduce tu clave de seguridad <strong>en el portal</strong>.</li>
        <li>Copia el título del mes y todos los jornales, en tabla o vista móvil; vuelve aquí y pégalos.</li>
      </ol>
      <form onSubmit={submit}>
        <label htmlFor="portal-paste-text">Texto copiado del portal</label>
        <textarea id="portal-paste-text" value={text} onChange={(event) => { setText(event.target.value); setError(''); }} placeholder="Pega aquí el mes y la tabla de jornales…" rows={7} autoCapitalize="off" autoComplete="off" spellCheck={false} />
        {parsed && <div className="portal-paste-preview" aria-live="polite">
          {parsed.monthKey && <strong>Mes detectado: {parsed.monthKey}</strong>}
          {parsed.errors.map((message, index) => <p className="portal-paste-error" key={index}>{message}</p>)}
          {!parsed.errors.length && <><div className="portal-paste-counts"><span><b>{parsed.rows.length}</b> leídos</span><span><b>{plan.newCount}</b> nuevos</span><span><b>{plan.premiumUpdates}</b> primas por completar</span><span><b>{plan.existingCount + plan.repeatedCount}</b> ya existentes</span></div>
            {plan.conflicts.map((message) => <p className="portal-paste-error" key={message}>{message}</p>)}
            {parsed.premiumsPending > 0 && <p className="portal-paste-warning">{parsed.premiumsHidden ? 'Las primas están ocultas.' : `${parsed.premiumsPending} jornales no muestran prima.`} Se importarán sin importe de prima. Para completarlas, pulsa el ojo en el portal, introduce allí tu clave de seguridad y vuelve a pegar el mes.</p>}
            {plan.actions.length === 0 && plan.conflicts.length === 0 && <p>Todos estos jornales ya están guardados. No se añadirá nada.</p>}
          </>}
        </div>}
        {error && <p className="portal-paste-error" role="alert">{error}</p>}
        <div className="portal-paste-actions"><button type="button" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className="primary" disabled={!ready || busy}><ClipboardPaste size={17} />{busy ? 'Importando…' : `Importar ${plan?.newCount || 0} jornales${plan?.premiumUpdates ? ` y ${plan.premiumUpdates} primas` : ''}`}</button></div>
      </form>
    </div>
  </section>;
}
