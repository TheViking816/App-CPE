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
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    await page.route('https://norayweb.cpevalencia.com/**', (route) => { portalReads++; return route.abort(); });
    await page.route('**/rest/v1/rpc/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(route.request().url().includes('app_cpe_get_portal_snapshot') ? { chapa: '72683', payload: { asignaciones: { rows: [old] } } } : { ok: true, detail: null }) }));
    await page.goto(`${origin}/App-CPE/.local/upcoming-preview.html`);
    await page.getByText('No hay próximos jornales en la lectura guardada').waitFor();
    await page.getByRole('button', { name: 'Ver parte guardado de ejemplo' }).waitFor();
    await page.getByRole('button', { name: 'Ver parte guardado de ejemplo' }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByText('PARTE GUARDADO · EJEMPLO DEL HISTORIAL', { exact: false }).waitFor();
    assert.equal(await page.getByRole('dialog').getByText('72683', { exact: true }).count(), 1);
    await page.keyboard.press('Escape');
    await page.locator('input[type=file]').setInputFiles({ name: 'upcoming-72683.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'upcoming-assignments', chapa: '72683', updatedAt: new Date().toISOString(), rows: [row] })) });
    await page.getByRole('button', { name: /CONDUCTOR 1a/ }).waitFor();
    await page.screenshot({ path: path.join(os.tmpdir(), `upcoming-preview-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: /CONDUCTOR 1a/ }).click();
    await page.getByRole('dialog').getByText('COMPAÑERO · PRUEBA', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').locator('.is-me').count(), 1);
    const dialogOverflow = await page.getByRole('dialog').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    assert.equal(dialogOverflow, false);
    await page.screenshot({ path: path.join(os.tmpdir(), `upcoming-part-${width}.png`), fullPage: true });
    assert.deepEqual(failures, []);
    console.log(`Vista ${width}px: archivo importado, parte y equipo visibles, 72683 resaltado, sin errores ni desbordamiento.`);
    await page.close();
  }
  assert.equal(portalReads, 0);
  console.log('Ninguna lectura del portal durante la comprobación.');
} finally { await browser.close(); await unlink(harness); }
