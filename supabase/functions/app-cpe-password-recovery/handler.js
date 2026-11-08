export const GENERIC_MESSAGE = 'Si tu chapa tiene un correo asociado, recibirás un enlace de recuperación.';
const APP_ORIGIN = 'https://cpe-app-flax.vercel.app';
const hex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export function createRecoveryHandler({ db, sendEmail, ipSalt }) {
  return async (req) => {
    const origin = req.headers.get('origin') || '';
    const allowed = origin === APP_ORIGIN || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': allowed ? origin : APP_ORIGIN, Vary: 'Origin',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowed) return json(403, { ok: false, message: 'Origen no permitido.' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json(405, { ok: false, message: 'Método no permitido.' });
    try {
      const raw = await req.text();
      if (raw.length > 2048) return json(400, { ok: false, message: 'Solicitud demasiado larga.' });
      let body;
      try { body = JSON.parse(raw); } catch { return json(400, { ok: false, message: 'Solicitud no válida.' }); }
      if (!body || typeof body !== 'object') return json(400, { ok: false, message: 'Solicitud no válida.' });
      if (body.action === 'request') {
        if (typeof body.chapa !== 'string' || !/^\d{1,5}$/.test(body.chapa)) return json(400, { ok: false, message: 'Introduce una chapa válida.' });
        // Supabase's gateway sets x-forwarded-for. Store only a salted hash.
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
        const ipHash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ipSalt}:${ip}`)));
        const { data, error } = await db.rpc('app_cpe_issue_password_reset', { p_chapa: body.chapa, p_ip_hash: ipHash });
        if (error) throw new Error('issue_failed');
        if (data) {
          try {
            await sendEmail({ to: data.email, token: data.token });
          } catch {
            await db.rpc('app_cpe_cancel_password_reset', { p_token: data.token });
            // Keep the same public response for accounts with and without email.
            console.error('App CPE recovery email delivery failed');
          }
        }
        return json(200, { ok: true, message: GENERIC_MESSAGE });
      }
      if (body.action === 'reset') {
        if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) return json(400, { ok: false, message: 'El enlace no es válido. Solicita uno nuevo.' });
        if (typeof body.password !== 'string' || body.password.length < 8 || new TextEncoder().encode(body.password).length > 72) return json(400, { ok: false, message: 'Usa al menos 8 caracteres y un máximo de 72 bytes.' });
        const { data, error } = await db.rpc('app_cpe_reset_password', { p_token: body.token, p_password: body.password });
        if (error) throw new Error('reset_failed');
        if (!data) return json(400, { ok: false, message: 'El enlace ha caducado o ya se ha utilizado. Solicita uno nuevo.' });
        return json(200, { ok: true });
      }
      return json(400, { ok: false, message: 'Solicitud no válida.' });
    } catch {
      console.error('App CPE password recovery request failed');
      return json(503, { ok: false, message: 'No se pudo procesar la solicitud. Vuelve a intentarlo.' });
    }
  };
}
