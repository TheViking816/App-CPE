import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildNorayPilotSnapshot, compareNorayPilotSnapshots } from './noray-personal-pilot-data.js';

const userUrl = new URL(process.env.CPE_NORAY_PILOT_URL || 'https://norayweb.cpevalencia.com/');
const profileDir = path.resolve(process.env.CPE_NORAY_PILOT_PROFILE || '');
const outputFile = path.resolve('.local/noray-pilot-72683.json');
const writeLocal = process.argv.includes('--write-local');

if (userUrl.origin !== 'https://norayweb.cpevalencia.com' || userUrl.pathname !== '/jornales'
  || userUrl.searchParams.get('usr') !== '72683'
  || !/^\d+$/.test(userUrl.searchParams.get('rec') || '')
  || !/^[a-f0-9]{64}$/i.test(userUrl.searchParams.get('pwd') || ''))
  throw new Error('Indica el enlace personal de Jornales y Primas de la chapa 72683.');
if (!process.env.CPE_NORAY_PILOT_PROFILE || !/noray-(?:proof|personal-pilot)/i.test(profileDir))
  throw new Error('Indica un perfil Chrome aislado para el piloto.');

const madridParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit'
}).formatToParts(new Date()).map((part) => [part.type, part.value]));
const year = Number(madridParts.year);
const month = Number(madridParts.month);
const rec = userUrl.searchParams.get('rec');

async function openSection(page, section, readyText) {
  const target = new URL(userUrl);
  target.pathname = `/${section}`;
  let response;
  try {
    response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch {
    throw new Error(`${section}: no se pudo abrir el enlace personal.`);
  }
  if (response?.status() !== 200) throw new Error(`${section}: HTTP ${response?.status() || 'sin respuesta'}`);
  await page.getByText(readyText, { exact: false }).first().waitFor({ timeout: 20_000 });
}

async function access(page) {
  const auth = await page.evaluate(async () => {
    const query = new URLSearchParams(location.search);
    const response = await fetch('/api/v1/auth/validar-acceso', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usr: query.get('usr'), rec: Number(query.get('rec')), pwd: query.get('pwd') })
    });
    return response.ok ? response.json() : null;
  });
  if (!auth?.intranet_access_token || !auth?.local_access_token) throw new Error('Noray no autorizó la lectura.');
  return auth;
}

async function get(page, endpoint, token) {
  const result = await page.evaluate(async ({ endpoint, token }) => {
    const response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { endpoint, token });
  if (result.status !== 200 || !result.body) throw new Error(`Noray ${endpoint.split('?')[0]}: HTTP ${result.status}`);
  return result.body;
}

const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome', headless: false, args: ['--no-first-run', '--start-minimized']
});
let snapshot;
try {
  const page = context.pages()[0] || await context.newPage();
  await openSection(page, 'jornales', 'Jornales del mes:');
  const journalAuth = await access(page);
  const base = await get(page, `/api/v1/jornales/${rec}/${year}/${month}?incluir_en_curso=false`, journalAuth.intranet_access_token);
  const vigentes = await get(page, `/api/v1/jornales-vigentes/${rec}/${year}/${month}`, journalAuth.local_access_token);

  await openSection(page, 'descansos', 'Grupos descanso:');
  const restAuth = await access(page);
  const [restHeader, restMonth, worker] = await Promise.all([
    get(page, `/api/v1/descansos/${rec}/cabecera/${year}/${month}`, restAuth.intranet_access_token),
    get(page, `/api/v1/descansos/${rec}/mes/${year}/${month}`, restAuth.intranet_access_token),
    get(page, `/api/v1/trabajadores/${rec}/completo`, restAuth.intranet_access_token)
  ]);

  await openSection(page, 'vacaciones', 'Periodos concedidos');
  const vacationAuth = await access(page);
  const vacationSummary = await get(page, `/api/v1/vacaciones/${rec}/resumen/${year}`, vacationAuth.intranet_access_token);
  snapshot = buildNorayPilotSnapshot({ chapa: '72683', year, month, base, vigentes, restHeader, restMonth, worker,
    vacationSummary, updatedAt: new Date().toISOString() });
} finally {
  await context.close();
}

let previous = null;
try { previous = JSON.parse(await fs.readFile(outputFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const changes = compareNorayPilotSnapshots(previous, snapshot);
if (writeLocal) {
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  const temporary = `${outputFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, outputFile);
}
console.log(JSON.stringify({ chapa: '72683', month: `${year}-${String(month).padStart(2, '0')}`,
  jornales: snapshot.journals.rows.length, calendarDays: snapshot.rests.days.length,
  vacations: snapshot.vacations.periods.length, changes, localFileUpdated: writeLocal }));
