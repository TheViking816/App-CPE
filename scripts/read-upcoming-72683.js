// Manual pilot only. No scheduler, queue or production writes.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readUpcomingNoray } from './upcoming-noray-reader.js';

if (process.argv[2] !== '--manual') throw new Error('Ejecuta este lector únicamente desde read-upcoming-72683.ps1.');
const link = process.env.CPE_UPCOMING_PERSONAL_URL;
delete process.env.CPE_UPCOMING_PERSONAL_URL;
if (!link) throw new Error('Falta el enlace personal de la prueba.');
const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
  const page = await browser.newPage();
  const data = await readUpcomingNoray(page, link);
  const output = path.resolve('.local', 'upcoming-72683.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Lectura completada: ${data.rows.length} jornales y sus equipos. Archivo: ${output}`);
} catch { console.error('Lectura detenida. No se guardó ni se publicó ninguna lectura parcial.'); process.exitCode = 1; }
finally { await browser.close(); }
