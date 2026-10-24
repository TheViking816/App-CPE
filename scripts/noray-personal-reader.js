import { buildNorayPilotSnapshot } from './noray-personal-pilot-data.js';

const origin = 'https://norayweb.cpevalencia.com';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function checkIdentity({ chapa, rec, pwd }) {
  if (!/^[0-9]{5}$/.test(String(chapa)) || !/^[1-9][0-9]{0,9}$/.test(String(rec))
    || !/^[a-f0-9]{64}$/i.test(String(pwd))) throw new Error('Datos de enlace no válidos');
}

async function openSection(page, identity, section, readyText) {
  const url = new URL(`/${section}`, origin);
  for (const [key, value] of Object.entries({ cal: 'gwt', mode: 'PROD', req: 'login', usr: identity.chapa,
    rec: identity.rec, pwd: identity.pwd })) url.searchParams.set(key, value);
  let response;
  try { response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 }); }
  catch { throw new Error(`${section}: no se pudo abrir`); }
  const status = response?.status();
  if (status !== 200) throw new Error(`${section}: HTTP ${status || 'sin respuesta'}`);
  try { await page.getByText(readyText, { exact: false }).first().waitFor({ timeout: 20_000 }); }
  catch { throw new Error(`${section}: no apareció el contenido esperado`); }
}

async function access(page, identity) {
  const result = await page.evaluate(async ({ usr, rec, pwd }) => {
    const response = await fetch('/api/v1/auth/validar-acceso', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usr, rec: Number(rec), pwd })
    });
    return { status: response.status, body: response.ok ? await response.json().catch(() => null) : null };
  }, { usr: identity.chapa, rec: identity.rec, pwd: identity.pwd });
  if (result.status !== 200 || !result.body?.intranet_access_token || !result.body?.local_access_token)
    throw new Error(`Noray no autorizó la lectura: HTTP ${result.status}`);
  return result.body;
}

async function get(page, endpoint, token) {
  const result = await page.evaluate(async ({ endpoint, token }) => {
    const response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: response.ok ? await response.json().catch(() => null) : null };
  }, { endpoint, token });
  if (result.status !== 200 || !result.body) throw new Error(`Noray no devolvió datos: HTTP ${result.status}`);
  return result.body;
}

export async function readPersonalNoraySnapshot(page, identity, { year, month, pauseMs = 500 } = {}) {
  checkIdentity(identity);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12)
    throw new Error('Periodo no válido');
  const { chapa, rec } = identity;
  await openSection(page, identity, 'jornales', 'Jornales del mes:');
  const journalAuth = await access(page, identity);
  const base = await get(page, `/api/v1/jornales/${rec}/${year}/${month}?incluir_en_curso=false`, journalAuth.intranet_access_token);
  await sleep(pauseMs);
  const vigentes = await get(page, `/api/v1/jornales-vigentes/${rec}/${year}/${month}`, journalAuth.local_access_token);
  await sleep(pauseMs);

  await openSection(page, identity, 'descansos', 'Grupos descanso:');
  const restAuth = await access(page, identity);
  const restHeader = await get(page, `/api/v1/descansos/${rec}/cabecera/${year}/${month}`, restAuth.intranet_access_token);
  await sleep(pauseMs);
  const restMonth = await get(page, `/api/v1/descansos/${rec}/mes/${year}/${month}`, restAuth.intranet_access_token);
  await sleep(pauseMs);
  const worker = await get(page, `/api/v1/trabajadores/${rec}/completo`, restAuth.intranet_access_token);
  await sleep(pauseMs);

  await openSection(page, identity, 'vacaciones', 'Periodos concedidos');
  const vacationAuth = await access(page, identity);
  const vacationSummary = await get(page, `/api/v1/vacaciones/${rec}/resumen/${year}`, vacationAuth.intranet_access_token);
  return buildNorayPilotSnapshot({ chapa, year, month, base, vigentes, restHeader, restMonth, worker,
    vacationSummary, updatedAt: new Date().toISOString() });
}
