import { assignmentDateKey, assignmentShift, madridDateKey, validateUpcomingReading } from '../src/upcomingAssignments.js';
import { sanitizeNorayPartDetail } from './noray-jornales.js';

export async function readUpcomingNoray(page, personalUrl, { now = new Date(), pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const link = new URL(personalUrl);
  if (link.origin !== 'https://norayweb.cpevalencia.com' || link.pathname !== '/jornales' || link.searchParams.get('usr') !== '72683'
    || !/^[1-9]\d{0,9}$/.test(link.searchParams.get('rec') || '') || !/^[a-f0-9]{64}$/i.test(link.searchParams.get('pwd') || '')
    || link.searchParams.get('req') !== 'login' || link.searchParams.get('mode') !== 'PROD') throw new Error('La prueba solo admite el enlace personal de Jornales de 72683.');
  const opened = await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (opened?.status() !== 200) throw new Error(`No se pudo abrir Jornales: HTTP ${opened?.status() || 'sin respuesta'}`);
  await page.getByText('Jornales del mes:', { exact: false }).first().waitFor({ timeout: 20000 });
  const authorized = await page.evaluate(async (identity) => {
    const response = await fetch('/api/v1/auth/validar-acceso', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(identity) });
    if (response.status !== 200) return { status: response.status };
    const result = await response.json();
    window.__cpeUpcomingTokens = { intranet: result.intranet_access_token, local: result.local_access_token };
    return { status: 200, ok: Boolean(result.intranet_access_token && result.local_access_token) };
  }, { usr: '72683', rec: Number(link.searchParams.get('rec')), pwd: link.searchParams.get('pwd') });
  if (!authorized.ok) throw new Error(`No se autorizó la lectura: HTTP ${authorized.status}`);
  const get = async (path, token = 'intranet') => {
    await pause(500);
    const response = await page.evaluate(async ({ path, token }) => {
      const response = await fetch(path, { headers: { authorization: `Bearer ${window.__cpeUpcomingTokens[token]}` } });
      return { status: response.status, body: response.status === 200 ? await response.json() : null };
    }, { path, token });
    if (response.status !== 200 || !response.body) throw new Error(`Lectura detenida: HTTP ${response.status}`);
    return response.body;
  };
  try {
    const today = madridDateKey(now), [year, month] = today.split('-').map(Number);
    const periods = [[year, month], month === 12 ? [year + 1, 1] : [year, month + 1]];
    const bySlot = new Map();
    for (const [currentYear, currentMonth] of periods) {
      const rec = link.searchParams.get('rec');
      const base = await get(`/api/v1/jornales/${rec}/${currentYear}/${currentMonth}?incluir_en_curso=true`);
      const current = await get(`/api/v1/jornales-vigentes/${rec}/${currentYear}/${currentMonth}`, 'local');
      if (!Array.isArray(base.jornales) || !Array.isArray(current.jornales)) throw new Error('El listado de jornales está incompleto.');
      for (const row of [...base.jornales, ...current.jornales]) {
        const fecha = assignmentDateKey(row.fecha) || assignmentDateKey(`${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(row.dia).padStart(2, '0')}`);
        const jornada = assignmentShift(row.jornada), parte = String(row.parte || '');
        if (!fecha || fecha < today || !jornada || !/^\d{1,10}$/.test(parte)) continue;
        bySlot.set(`${fecha}|${jornada}`, { parte, fecha, jornada, especialidad: String(row.especialidad || ''), empresa: String(row.empresa || ''), buque: String(row.buque || ''), operacion: String(row.operacion || ''), tipo: String(row.tipo || '') });
      }
    }
    if (bySlot.size > 30) throw new Error('Hay más de 30 partes próximos; revisa el listado antes de ampliar la prueba.');
    const details = new Map(), rows = [];
    for (const item of bySlot.values()) {
      const year = item.fecha.slice(0, 4), key = `${year}|${item.parte}`;
      if (!details.has(key)) {
        const raw = await get(`/api/v1/partes/${year}/${item.parte}`);
        const detail = sanitizeNorayPartDetail(raw, item);
        if (!detail) throw new Error(`No se pudo leer el equipo del parte ${item.parte}.`);
        // Keep workers whose code exists even if their name is unavailable.
        detail.specialties = (raw.grupos || []).map((group) => ({ name: String(group.especialidad || 'Sin especialidad'), requested: Math.max(0, Number(group.solicitados) || 0), workers: (group.trabajadores || []).map((worker) => ({ code: String(worker.chapa || '').replace(/\D/g, ''), name: String(worker.nombre || ''), type: String(worker.tipo || '') })).filter((worker) => worker.code) })).filter((group) => group.workers.length || group.requested);
        if (!detail.specialties.length) throw new Error(`El equipo del parte ${item.parte} está vacío.`);
        details.set(key, detail);
      }
      rows.push({ ...item, detail: details.get(key) });
    }
    return validateUpcomingReading({ schemaVersion: 1, kind: 'upcoming-assignments', chapa: '72683', updatedAt: now.toISOString(), rows });
  } finally { await page.evaluate(() => { delete window.__cpeUpcomingTokens; }).catch(() => {}); }
}
