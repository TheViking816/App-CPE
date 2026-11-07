import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/noray-section.js';

function response() {
  return {
    headers: {}, statusCode: 200, body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value = '') { this.body = value; }
  };
}

test('personal Noray relay accepts only saved sections and the official host', async () => {
  const previousKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const previousFetch = globalThis.fetch;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  const requests = [];
  const tracked = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/app_cpe_track_personal_link_open')) {
      tracked.push(JSON.parse(options.body));
      return { ok: true };
    }
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => 'https://norayweb.cpevalencia.com/vacaciones?cal=gwt&mode=PROD&req=login&usr=72683&rec=2611&pwd=' + 'a'.repeat(64) };
  };
  try {
    const invalid = response();
    await handler({ method: 'POST', body: { token: 'session', section: 'donde-voy' }, headers: {} }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(requests.length, 0);

    const allowed = response();
    await handler({ method: 'POST', body: { token: 'session', section: 'vacaciones' }, headers: {} }, allowed);
    assert.equal(allowed.statusCode, 303);
    assert.equal(allowed.headers['referrer-policy'], 'no-referrer');
    assert.equal(requests[0].body.p_section, 'vacaciones');
    assert.deepEqual(tracked[0], { p_token: 'session', p_section: 'vacaciones' });

    const jornales = response();
    await handler({ method: 'POST', body: { token: 'session', section: 'jornales' }, headers: {} }, jornales);
    assert.equal(jornales.statusCode, 303);
    assert.equal(new URL(jornales.headers.location).pathname, '/jornales');
    assert.equal(requests[1].body.p_section, 'dobles');
    assert.deepEqual(tracked[1], { p_token: 'session', p_section: 'jornales' });

    const descansos = response();
    await handler({ method: 'POST', body: { token: 'session', section: 'descansos' }, headers: {} }, descansos);
    assert.equal(descansos.statusCode, 303);
    assert.equal(new URL(descansos.headers.location).pathname, '/descansos');
    assert.equal(requests[2].body.p_section, 'dobles');

    for (const section of ['chapero', 'chapero-especialidades', 'puertas', 'jornada-contratada', 'situacion-trabajador', 'excepciones-pedidas', 'mis-especialidades', 'solicito-formacion', 'disponibilidad12m']) {
      const personal = response();
      await handler({ method: 'POST', body: { token: 'session', section }, headers: {} }, personal);
      assert.equal(personal.statusCode, 303);
      assert.equal(new URL(personal.headers.location).pathname, `/${section}`);
      assert.equal(tracked.at(-1).p_section, section);
    }

    globalThis.fetch = async () => ({ ok: true, json: async () => 'https://example.com/vacaciones?usr=72683&rec=2611&pwd=' + 'a'.repeat(64) });
    const wrongHost = response();
    await handler({ method: 'POST', body: { token: 'session', section: 'vacaciones' }, headers: {} }, wrongHost);
    assert.equal(wrongHost.statusCode, 502);
    assert.equal(wrongHost.headers.location, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    else process.env.VITE_SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});

test('calendario personal usa la identidad guardada de cada sesión y el formato PHP', async () => {
  const previousKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const previousFetch = globalThis.fetch;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-key';
  try {
    for (const [savedPath, chapa, rec] of [['dobles', '71111', '101'], ['vacaciones', '72222', '202'], ['donde-voy', '73333', '303'], ['descansos', '74444', '404']]) {
      const calls = [];
      globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push({ url, body });
        if (url.endsWith('/app_cpe_track_personal_link_open')) return { ok: true };
        const matches = savedPath === 'donde-voy' ? url.endsWith('/app_cpe_get_manual_donde_voy_link')
          : savedPath === 'descansos' ? url.endsWith('/app_cpe_get_noray_link') && body.p_section === 'descansos'
          : url.endsWith('/app_cpe_get_manual_noray_section_link') && body.p_section === savedPath;
        return { ok: true, json: async () => matches ? `https://norayweb.cpevalencia.com/${savedPath}?cal=gwt&mode=PROD&req=login&usr=${chapa}&rec=${rec}&pwd=${'b'.repeat(64)}` : null };
      };
      const result = response();
      // Identidades recibidas del formulario no pueden sustituir la sesión.
      await handler({ method: 'POST', headers: {}, body: { token: `session-${chapa}`, section: 'calendario-base', usr: '79999', rec: '999' } }, result);
      assert.equal(result.statusCode, 303);
      const target = new URL(result.headers.location);
      assert.equal(target.origin, 'https://norayweb.cpevalencia.com');
      assert.equal(target.pathname, '/calendario-base');
      assert.deepEqual(Object.fromEntries(target.searchParams), { cal: 'php', req: 'login', usr: chapa, rec, pwd: 'b'.repeat(64) });
      assert.ok(calls.every(call => call.body.p_token === `session-${chapa}`));
      assert.equal(result.headers['cache-control'], 'private, no-store, max-age=0');
    }
    globalThis.fetch = async () => ({ ok: true, json: async () => null });
    const missing = response();
    await handler({ method: 'POST', headers: {}, body: { token: 'no-links', section: 'calendario-base' } }, missing);
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.headers.location, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    else process.env.VITE_SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});
