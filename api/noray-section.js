const SUPABASE_REF = 'wvwdiywtlbffumshbboa';
const SECTIONS = new Set(['vacaciones', 'dobles']);

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
    const result = await fetch(`${base}/rest/v1/rpc/app_cpe_get_manual_noray_section_link`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_token: token, p_section: section }),
      cache: 'no-store'
    });
    if (!result.ok) return respond(response, 404, 'Acceso no disponible.');
    const raw = await result.json();
    if (typeof raw !== 'string') return respond(response, 404, 'Acceso no disponible.');
    const target = new URL(raw);
    if (target.origin !== 'https://norayweb.cpevalencia.com' || target.pathname !== `/${section}`
      || !/^\d{5}$/.test(target.searchParams.get('usr') || '')
      || !/^[1-9]\d{0,9}$/.test(target.searchParams.get('rec') || '')
      || !/^[a-f0-9]{64}$/i.test(target.searchParams.get('pwd') || '')
      || target.searchParams.get('mode') !== 'PROD' || target.searchParams.get('req') !== 'login') {
      return respond(response, 502, 'Enlace no válido.');
    }
    response.statusCode = 303;
    response.setHeader('location', target.href);
    response.end();
  } catch {
    respond(response, 503, 'No se pudo abrir la página.');
  }
}
