import fs from 'node:fs/promises';
import capture from '../src/censosPortalWorkersCurrent.js';

const targets = {
  '72683': { 'CONDUCTOR 1a': ['conductor-1a', 'TU'], 'CONDUCTOR 2a': ['conductor-2a', 'TU'] },
  '72710': { TRINCADOR: ['pol-trincador', 'TP'], 'TRINCA COCHES': ['pol-trinca-coches', 'TP'], ESPECIALISTA: ['pol-especialista', 'TP'] }
};
const inputs = process.argv.slice(2).filter(arg => arg !== '--apply');
if (inputs.length !== 2) throw new Error('Se requieren las capturas únicas de 72683 y 72710.');
const payloads = await Promise.all(inputs.map(async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''))));
if (new Set(payloads.map(p => p.sourceUser)).size !== 2) throw new Error('Cuentas repetidas.');
const report = [];
const next = structuredClone(capture);
for (const payload of payloads) {
  const definitions = targets[payload.sourceUser];
  if (!definitions || !Number.isFinite(Date.parse(payload.capturedAt)) || payload.cards?.length !== Object.keys(definitions).length) throw new Error('Captura no autorizada o incompleta.');
  for (const [name, [id, type]] of Object.entries(definitions)) {
    const cards = payload.cards.filter(card => card.name === name);
    if (cards.length !== 1) throw new Error(`Bloque ausente o repetido: ${name}.`);
    const card = cards[0];
    const previous = capture.cards.find(c => c.id === id);
    const chapas = card.chapas;
    if (card.type !== type || !Array.isArray(chapas) || chapas.length !== card.declared || chapas.length < 1
      || chapas.some(chapa => !/^\d{5}$/.test(chapa)) || new Set(chapas).size !== chapas.length
      || Date.parse(payload.capturedAt) < Date.parse(previous.capturedAt)) throw new Error(`Censo inválido: ${name}.`);
    const keys = { LAB: 'Lab', NOC: 'Noc', 'NOC-FES': 'NocFes', FES: 'Fes' };
    const doors = previous.doors.map(door => {
      const raw = String(card.doors?.[keys[door.key]] || '');
      if (!/^\d{5}$/.test(raw) || !chapas.includes(raw)) throw new Error(`Puerta ausente: ${name} ${door.key}.`);
      return { ...door, raw: Number(raw) };
    });
    const changed = chapas.join(',') !== previous.censo.join(',');
    report.push({ id, sourceUser: payload.sourceUser, before: previous.censo.length, after: chapas.length,
      added: chapas.filter(c => !previous.censo.includes(c)), removed: previous.censo.filter(c => !chapas.includes(c)),
      moved: chapas.filter((c, i) => previous.censo.includes(c) && previous.censo.indexOf(c) !== i).length, changed });
    if (changed) {
      const replacement = { ...previous, censo: chapas, expectedSize: chapas.length, doors,
        capturedAt: payload.capturedAt, sourceUser: payload.sourceUser };
      if (id.startsWith('conductor-')) replacement.previousCenso = previous.censo;
      next.cards[next.cards.findIndex(c => c.id === id)] = replacement;
    }
  }
}
if (process.argv.includes('--apply') && report.some(r => r.changed)) {
  next.capturedAt = payloads.map(p => p.capturedAt).sort().at(-1);
  next.sourceUsers = [...new Set(next.cards.map(c => c.sourceUser))];
  await fs.writeFile(new URL('../src/censosPortalWorkersCurrent.js', import.meta.url),
    `// Capturas verificadas del Chapero por especialidades. Fecha y origen por bloque; sin enlaces ni credenciales.\nexport default ${JSON.stringify(next, null, 2)};\n`);
}
console.log(JSON.stringify({ applied: process.argv.includes('--apply'), report }, null, 2));
