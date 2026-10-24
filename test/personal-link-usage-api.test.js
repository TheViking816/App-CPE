import test from 'node:test';
import assert from 'node:assert/strict';
import sectionHandler from '../api/noray-section.js';
import contractingHandler from '../api/donde-voy.js';

function response() {
  return { headers: {}, statusCode: 200, setHeader(name, value) { this.headers[name] = value; }, end() {} };
}

for (const [name, handler, section, savedPath] of [
  ['contratación', contractingHandler, 'donde-voy', 'donde-voy'],
  ['secciones', sectionHandler, 'jornales', 'dobles']
]) {
  test(`${name}: registra solo la sección, sin la URL personal, y entrega el enlace`, async () => {
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-key';
    const tracking = [];
    const secretUrl = `https://norayweb.cpevalencia.com/${savedPath}?cal=gwt&mode=PROD&req=login&usr=72760&rec=99&pwd=${'a'.repeat(64)}`;
    globalThis.fetch = async (url, options) => {
      if (url.endsWith('/app_cpe_track_personal_link_open')) {
        tracking.push(JSON.parse(options.body));
        assert.ok(options.signal instanceof AbortSignal);
        return { ok: true };
      }
      return { ok: true, json: async () => secretUrl };
    };
    try {
      const result = response();
      await handler({ method: 'POST', headers: {}, body: { token: 'own-session', section } }, result);
      assert.equal(result.statusCode, 303);
      assert.equal(new URL(result.headers.location).pathname, `/${section}`);
      assert.deepEqual(tracking, [{ p_token: 'own-session', p_section: section }]);
      assert.doesNotMatch(JSON.stringify(tracking), /pwd|rec=|norayweb|usr=/);

      tracking.length = 0;
      globalThis.fetch = async (url) => {
        if (url.endsWith('/app_cpe_track_personal_link_open')) tracking.push('unexpected');
        return { ok: true, json: async () => 'https://wrong.example/unsafe' };
      };
      const invalid = response();
      await handler({ method: 'POST', headers: {}, body: { token: 'own-session', section } }, invalid);
      assert.equal(invalid.statusCode, 502);
      assert.equal(invalid.headers.location, undefined);
      assert.deepEqual(tracking, []);

      globalThis.fetch = async (url) => {
        if (url.endsWith('/app_cpe_track_personal_link_open')) throw new Error('monitor unavailable');
        return { ok: true, json: async () => secretUrl };
      };
      const unavailableMonitor = response();
      await handler({ method: 'POST', headers: {}, body: { token: 'own-session', section } }, unavailableMonitor);
      assert.equal(unavailableMonitor.statusCode, 303);
      assert.equal(new URL(unavailableMonitor.headers.location).pathname, `/${section}`);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      else process.env.VITE_SUPABASE_PUBLISHABLE_KEY = previousKey;
    }
  });
}
