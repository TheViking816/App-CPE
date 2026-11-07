import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import handler from '../api/noray-section.js';
import contractingHandler from '../api/donde-voy.js';
import { personalLinkLabels, personalLinkCounts } from '../lib/personalLinkSections.js';
import { afterNativeSubmit } from '../src/afterNativeSubmit.js';

test('todos los enlaces publicados se registran y se muestran en Monitor', async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-key';
  try {
    for (const section of Object.keys(personalLinkLabels)) {
      const tracked = [];
      globalThis.fetch = async (url, options) => {
        if (url.endsWith('/app_cpe_track_personal_link_open')) {
          tracked.push(JSON.parse(options.body));
          return { ok: true };
        }
        const saved = section === 'donde-voy' ? 'donde-voy' : section === 'dobles' || section === 'vacaciones' ? section : 'dobles';
        return { ok: true, json: async () => `https://norayweb.cpevalencia.com/${saved}?cal=gwt&mode=PROD&req=login&usr=71111&rec=101&pwd=${'a'.repeat(64)}` };
      };
      const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end() {} };
      await (section === 'donde-voy' ? contractingHandler : handler)({ method: 'POST', headers: {}, body: { token: 'own-session', section } }, response);
      assert.equal(response.statusCode, 303, section);
      assert.deepEqual(tracked, [{ p_token: 'own-session', p_section: section }], section);
      assert.doesNotMatch(JSON.stringify(tracked), /pwd|usr=|rec=|norayweb/);
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    else process.env.VITE_SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
  const migration = fs.readFileSync(new URL('../supabase/migrations/20261107103453_track_all_personal_links.sql', import.meta.url), 'utf8');
  const lists = [...migration.matchAll(/section (?:not )?in \(([\s\S]*?)\)/g)];
  assert.equal(lists.length, 2);
  for (const [, list] of lists) assert.deepEqual(new Set([...list.matchAll(/'([^']+)'/g)].map(match => match[1])), new Set(Object.keys(personalLinkLabels)));
  for (const file of ['ManualApp.jsx', 'ManualOperationalSnapshots.jsx']) {
    const source = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    for (const [, section] of source.matchAll(/(?:section|name="section" value)="([a-z0-9-]+)"/g))
      assert.ok(Object.hasOwn(personalLinkLabels, section), section);
  }
});

test('Monitor incluye los enlaces sin aperturas y conserva los contadores reales', () => {
  const counts = personalLinkCounts([{ section: 'calendario-base', opens: 3 }]);
  assert.equal(counts.length, 16);
  assert.equal(counts.find(item => item.section === 'calendario-base').opens, 3);
  assert.equal(counts.find(item => item.section === 'excepciones-pedidas').opens, 0);
});

test('el aviso sigue conectado durante el envío nativo del formulario', async () => {
  let connected = true;
  afterNativeSubmit(() => { connected = false; });
  assert.equal(connected, true, 'el navegador debe poder iniciar el POST antes de retirar el aviso');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(connected, false);
});
