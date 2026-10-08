const SUPABASE_REF = 'wvwdiywtlbffumshbboa';
const SECTIONS = new Set(['vacaciones', 'dobles', 'jornales']);

function respond(response, status, message) {
  response.statusCode = status;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(message);
}

function bodyOf(request) {
  if (request.body instanceof URLSearchParams) return Object.fromEntries(request.body);
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) return request.body;
  return Object.fromEntries(new URLSearchParams(Buffer.isBuffer(request.body) ? request.body.toString('utf8') : String(request.body || '')));
}

async function savedLink(base, key, functionName, token, extra = {}) {
  const result = await fetch(`${base}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_token: token, ...extra }),
    cache: 'no-store'
  });
  if (!result.ok) return null;
  const value = await result.json();
  return typeof value === 'string' ? value : null;
}

export default async function handler(request, response) {
  response.setHeader('cache-control', 'private, no-store, max-age=0');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-robots-tag', 'noindex, nofollow');
  if (request.method !== 'POST') return respond(response, 405, 'Método no permitido.');
  if (Number(request.headers['content-length'] || 0) > 4096) return respond(response, 413, 'Solicitud demasiado grande.');
  const submitted = bodyOf(request);
  const token = String(submitted.token || '');
  const section = String(submitted.section || '');
  if (!token || token.length > 256 || !SECTIONS.has(section)) return respond(response, 400, 'Acceso no disponible.');
  const source = String(process.env.VITE_SUPABASE_URL || '').replace(/\r|\n/g, '').trim().split(/\s+/)[0];
  const base = /^[a-z0-9]{20}$/i.test(source) ? `https://${source}.supabase.co` : (source || `https://${SUPABASE_REF}.supabase.co`).replace(/\/$/, '');
  const key = String(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!key) return respond(response, 503, 'Acceso no disponible.');
  try {
    const raw = section === 'jornales'
      ? await savedLink(base, key, 'app_cpe_get_manual_noray_section_link', token, { p_section: 'dobles' })
        || await savedLink(base, key, 'app_cpe_get_manual_noray_section_link', token, { p_section: 'vacaciones' })
        || await savedLink(base, key, 'app_cpe_get_manual_donde_voy_link', token)
        || await savedLink(base, key, 'app_cpe_get_noray_link', token, { p_section: 'donde-voy' })
      : await savedLink(base, key, 'app_cpe_get_manual_noray_section_link', token, { p_section: section });
    if (!raw) return respond(response, 404, 'Acceso no disponible.');
    const target = new URL(raw);
    const sourceSections = section === 'jornales' ? ['/dobles', '/vacaciones', '/donde-voy'] : [`/${section}`];
    if (target.origin !== 'https://norayweb.cpevalencia.com' || !sourceSections.includes(target.pathname)
      || !/^\d{4,8}$/.test(target.searchParams.get('usr') || '')
      || !/^[1-9]\d{0,9}$/.test(target.searchParams.get('rec') || '')
      || !/^[a-f0-9]{64}$/i.test(target.searchParams.get('pwd') || '')
      || target.searchParams.get('mode') !== 'PROD' || target.searchParams.get('req') !== 'login') {
      return respond(response, 502, 'Enlace no válido.');
    }
    if (section === 'jornales') target.pathname = '/jornales';
    response.statusCode = 303;
    response.setHeader('location', target.href);
    response.end();
  } catch {
    respond(response, 503, 'No se pudo abrir la página.');
  }
}
