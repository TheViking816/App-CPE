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
  globalThis.fetch = async (url, options) => {
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

    const jornales = response();
    await handler({ method: 'POST', body: { token: 'session', section: 'jornales' }, headers: {} }, jornales);
    assert.equal(jornales.statusCode, 303);
    assert.equal(new URL(jornales.headers.location).pathname, '/jornales');
    assert.equal(requests[1].body.p_section, 'dobles');

    const descansos = response();
    await handler({ method: 'POST', body: { token: 'session', section: 'descansos' }, headers: {} }, descansos);
    assert.equal(descansos.statusCode, 303);
    assert.equal(new URL(descansos.headers.location).pathname, '/descansos');
    assert.equal(requests[2].body.p_section, 'dobles');

    for (const section of ['chapero', 'puertas', 'jornada-contratada']) {
      const personal = response();
      await handler({ method: 'POST', body: { token: 'session', section }, headers: {} }, personal);
      assert.equal(personal.statusCode, 303);
      assert.equal(new URL(personal.headers.location).pathname, `/${section}`);
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
