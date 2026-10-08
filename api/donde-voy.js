const SUPABASE_REF = 'wvwdiywtlbffumshbboa';

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

async function getLink(base, key, functionName, token, extra = {}) {
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
  const chapa = String(submitted.chapa || '');
  if (!token || token.length > 256) return respond(response, 400, 'Acceso no disponible.');
  if (chapa && !/^\d{5}$/.test(chapa)) return respond(response, 400, 'Acceso no disponible.');
  const source = String(process.env.VITE_SUPABASE_URL || '').replace(/\\r|\\n/g, '').trim().split(/\s+/)[0];
  const base = /^[a-z0-9]{20}$/i.test(source) ? `https://${source}.supabase.co` : (source || `https://${SUPABASE_REF}.supabase.co`).replace(/\/$/, '');
  const key = String(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!key) return respond(response, 503, 'Acceso no disponible.');
  try {
    const raw = await getLink(base, key, 'app_cpe_get_manual_donde_voy_link', token, chapa ? { p_chapa: chapa } : {})
      || (!chapa && await getLink(base, key, 'app_cpe_get_noray_link', token, { p_section: 'donde-voy' }));
    if (!raw) return respond(response, 404, 'Acceso no disponible.');
    const target = new URL(raw);
    if (target.origin !== 'https://norayweb.cpevalencia.com' || target.pathname !== '/donde-voy'
      || !/^\d{4,8}$/.test(target.searchParams.get('usr') || '')
      || !/^[1-9]\d{0,9}$/.test(target.searchParams.get('rec') || '')
      || !/^[a-f0-9]{64}$/i.test(target.searchParams.get('pwd') || '')) {
      return respond(response, 502, 'Enlace no válido.');
    }
    response.statusCode = 303;
    response.setHeader('location', target.href);
    response.end();
  } catch {
    respond(response, 503, 'No se pudo abrir la página.');
  }
}
