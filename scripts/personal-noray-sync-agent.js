import { chromium } from 'playwright';
import os from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { readPersonalNoraySnapshot } from './noray-personal-reader.js';
import { resolveSupabaseAdminKey, supabaseAdminHeaders } from './supabase-admin.js';

const key = resolveSupabaseAdminKey();
if (!key) throw new Error('Falta la credencial local del agente.');
const endpoint = String(process.env.CPE_SUPABASE_URL || 'https://wvwdiywtlbffumshbboa.supabase.co').replace(/\/$/, '');
const workerId = `${os.hostname()}-personal-noray`.slice(0, 120);
const profile = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'AppCPE', 'personal-noray-chrome');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let running = false;
let stopRequested = false;

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopRequested = true; });

async function rpc(name, payload = {}) {
  const response = await fetch(`${endpoint}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: supabaseAdminHeaders(key, { 'content-type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

const heartbeat = () => rpc('app_cpe_personal_sync_heartbeat', {
  p_worker_id: workerId, p_state: running ? 'running' : 'idle'
});

function currentMadridMonth() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit'
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month) };
}

async function processRun(run) {
  running = true;
  let context;
  const pulse = setInterval(() => heartbeat().catch(() => {}), 10_000);
  try {
    await mkdir(profile, { recursive: true });
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome', headless: false, args: ['--no-first-run', '--start-minimized']
    });
    const page = context.pages()[0] || await context.newPage();
    const period = currentMadridMonth();
    while (!stopRequested) {
      const item = await rpc('app_cpe_personal_sync_next', { p_run_id: run.id, p_worker_id: workerId });
      if (!item) return;
      try {
        await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(() => {});
        await context.clearCookies();
        const snapshot = await readPersonalNoraySnapshot(page, item, period);
        await rpc('app_cpe_personal_sync_save', {
          p_run_id: run.id, p_worker_id: workerId, p_chapa: item.chapa, p_snapshot: snapshot
        });
        console.log(`[personal-noray] ${item.chapa}: datos guardados`);
      } catch (error) {
        const message = String(error?.message || 'Error de lectura').slice(0, 180);
        await rpc('app_cpe_personal_sync_stop', { p_run_id: run.id, p_worker_id: workerId, p_message: message });
        console.error(`[personal-noray] ${item.chapa}: ${message}. Lote detenido sin reintentos.`);
        return;
      }
      await delay(8_000);
    }
    await rpc('app_cpe_personal_sync_stop', {
      p_run_id: run.id, p_worker_id: workerId, p_message: 'Agente detenido desde el PC'
    });
  } catch (error) {
    const message = String(error?.message || 'Error del agente').slice(0, 180);
    await rpc('app_cpe_personal_sync_stop', { p_run_id: run.id, p_worker_id: workerId, p_message: message }).catch(() => {});
    console.error(`[personal-noray] ${message}. Lote detenido sin reintentos.`);
  } finally {
    clearInterval(pulse);
    await context?.close().catch(() => {});
    running = false;
  }
}

await heartbeat();
console.log('[personal-noray] Agente preparado. Esperando una orden manual de 72683.');
while (!stopRequested) {
  try {
    await heartbeat();
    const run = await rpc('app_cpe_personal_sync_claim', { p_worker_id: workerId });
    if (run?.id) await processRun(run);
  } catch (error) { console.error(`[personal-noray] ${String(error?.message || 'Error de conexión').slice(0, 180)}`); }
  await delay(10_000);
}
