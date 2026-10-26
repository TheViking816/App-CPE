import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { madridDateKey } from '../src/upcomingAssignments.js';

const browser = await chromium.launch({ headless: true });
const origin = process.env.UPCOMING_TEST_ORIGIN || 'http://127.0.0.1:5188';
const today = madridDateKey();
const row = { parte: '30964', fecha: today, jornada: '02-08', empresa: 'CSP IBERIAN VALENCIA TERMINAL', especialidad: 'CONDUCTOR 1a', buque: 'CMA CGM AMBITION', operacion: 'CONT. C/SPREADER AUT', detail: { recognized: true, parte: '30964', fecha: today, jornada: '02-08', empresa: 'CSP IBERIAN VALENCIA TERMINAL', buque: 'CMA CGM AMBITION', operacion: 'CONT. C/SPREADER AUT', muelle: 'PRÍNCIPE FELIPE', specialties: [{ name: 'CONDUCTOR 1a', requested: 2, workers: [{ code: '72683', name: 'ADRIAN · PRUEBA' }, { code: '72684', name: 'COMPAÑERO · PRUEBA' }] }] } };
const old = { ...row, fecha: '2026-10-08', detail: { ...row.detail, fecha: '2026-10-08' } };
let portalReads = 0;
const harness = path.resolve('.local/upcoming-preview.html');
await mkdir(path.dirname(harness), { recursive: true });
await writeFile(harness, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="upcoming-ui-test" style="max-width:980px;margin:20px auto;padding:12px"></div><script type="module">import React from 'react'; import {createRoot} from 'react-dom/client'; import Upcoming from '../src/UpcomingAssignments.jsx'; import '../src/manual.css'; createRoot(document.getElementById('upcoming-ui-test')).render(React.createElement(Upcoming,{session:{chapa:'72683',token:'test-only'},snapshot:{payload:{asignaciones:{rows:[]}}}}));</script></body></html>`);
try {
  for (const width of [1280, 390]) {
    let withReading = false;
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    await page.route('https://norayweb.cpevalencia.com/**', (route) => { portalReads++; return route.abort(); });
    await page.route('**/rest/v1/rpc/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(route.request().url().includes('app_cpe_get_portal_snapshot') ? { chapa: '72683', payload: { asignaciones: { rows: [old] } } } : route.request().url().includes('app_cpe_get_portal_preview_snapshot') ? { chapa: '72683', payload: withReading ? { upcomingAssignments: { schemaVersion: 1, kind: 'upcoming-assignments', chapa: '72683', updatedAt: new Date().toISOString(), rows: [row] } } : {} } : { ok: true, detail: null }) }));
    await page.goto(`${origin}/App-CPE/.local/upcoming-preview.html`);
    await page.getByText('Sin próximas contrataciones', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /ejemplo|Cargar lectura|prueba/i }).count(), 0);
    withReading = true;
    await page.reload();
    await page.getByRole('button', { name: /CONDUCTOR 1a/ }).waitFor();
    await page.screenshot({ path: path.join(os.tmpdir(), `upcoming-preview-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: /CONDUCTOR 1a/ }).click();
    await page.getByRole('dialog').getByText('COMPAÑERO · PRUEBA', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').locator('.is-me').count(), 1);
    const dialogOverflow = await page.getByRole('dialog').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    assert.equal(dialogOverflow, false);
    await page.screenshot({ path: path.join(os.tmpdir(), `upcoming-part-${width}.png`), fullPage: true });
    assert.deepEqual(failures, []);
    console.log(`Vista ${width}px: contratación integrada, parte y equipo visibles, 72683 resaltado, sin controles de prueba ni desbordamiento.`);
    await page.close();
  }
  for (const chapa of ['72683', '72710']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const session = { chapa, token: 'test-only', supportAccess: true, displayName: 'USUARIO', irpfRate: 20 };
    await page.addInitScript((session) => localStorage.setItem('app-cpe-session', JSON.stringify(session)), session);
    let realReading = false;
    let linked = true;
    await page.route('https://*.supabase.co/**', (route) => {
      const url = route.request().url();
      let body = [];
      if (url.includes('app_cpe_get_portal_preview_snapshot')) body = { chapa, payload: realReading ? { upcomingAssignments: { schemaVersion: 1, kind: 'upcoming-assignments', chapa: '72683', updatedAt: new Date().toISOString(), rows: [row] } } : {} };
      else if (url.includes('app_cpe_get_portal_snapshot')) body = { chapa, payload: { asignaciones: { rows: [old] } } };
      else if (url.includes('app_cpe_get_saved_salary_history')) body = { chapa, payload: { jornales: { history: [], rows: [] } } };
      else if (url.includes('app_cpe_get_current_user') || url.includes('app_cpe_get_personal_noray_snapshot') || url.includes('app_cpe_mobile_get_my_salary_premiums')) body = null;
      else if (url.includes('app_cpe_portal_link_request_status')) body = { hasPortalPassword: linked, hasPremiumKey: linked };
      else if (url.includes('app_cpe_has_manual_donde_voy_link')) body = linked;
      else if (url.includes('app_cpe_has_manual') || url.includes('app_cpe_can_open')) body = false;
      else if (/get_(manual_premiums|relay_hours|remate_hours)/.test(url)) body = {};
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`${origin}/App-CPE/#/sueldometro`);
    await page.getByRole('heading', { name: 'Sueldómetro', exact: true }).waitFor();
    const integrated = page.getByRole('region', { name: 'Próximas contrataciones' });
    assert.equal(await integrated.count(), 0);
    if (chapa === '72683') {
      assert.equal(await page.locator('form[action="/api/donde-voy"]').count(), 0);
      await page.getByRole('button', { name: 'Inicio', exact: true }).click();
      await page.getByRole('heading', { name: 'Mi contratación', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Abrir mi contratación', exact: true }).waitFor();
      await integrated.waitFor();
      await page.getByRole('region', { name: 'Distancias a las puertas' }).waitFor();
      assert.equal(await page.getByRole('button', { name: /Cargar lectura/i }).count(), 0);
      const example = page.getByRole('region', { name: 'Parte de ejemplo' });
      await example.getByRole('button', { name: /Ejemplo del historial/ }).waitFor();
      await page.screenshot({ path: path.join(os.tmpdir(), 'upcoming-full-app-1280.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 850 });
      await page.screenshot({ path: path.join(os.tmpdir(), 'upcoming-full-app-390.png'), fullPage: true });
      await example.getByRole('button').click();
      await page.getByRole('dialog').getByText('EJEMPLO DEL HISTORIAL', { exact: false }).waitFor();
      await page.getByRole('dialog').getByText('COMPAÑERO · PRUEBA', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(os.tmpdir(), 'upcoming-example-modal-390.png'), fullPage: true });
      await page.keyboard.press('Escape');
      realReading = true;
      await page.reload();
      await integrated.getByRole('button', { name: /CONDUCTOR 1a/ }).waitFor();
      assert.equal(await example.count(), 0);
      linked = false;
      await page.reload();
      await page.getByRole('button', { name: 'Vincular portal', exact: true }).click();
      await page.getByRole('dialog', { name: 'Vincular portal' }).waitFor();
      await page.keyboard.press('Escape');
      await page.goto(`${origin}/App-CPE/#/chapero`);
      await page.getByRole('heading', { name: 'Chapero', exact: true }).waitFor();
      assert.equal(await page.locator('.doors-wrap').count(), 0);
      await page.goto(`${origin}/App-CPE/#/contratacion`);

      await page.getByRole('heading', { name: 'Mi contratación', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Sueldómetro', exact: true }).click();
      await page.getByRole('heading', { name: 'Sueldómetro', exact: true }).waitFor();
      assert.equal(await integrated.count(), 0);
    } else {
      assert.equal(await page.getByRole('button', { name: 'Inicio', exact: true }).count(), 0);
    }
    console.log(`App completa ${chapa}: integración y visibilidad correctas.`);
    await page.close();
  }
  assert.equal(portalReads, 0);
  console.log('Ninguna lectura del portal durante la comprobación.');
} finally { await browser.close(); await unlink(harness); }
