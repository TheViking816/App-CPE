import fs from 'node:fs/promises';
import capture from '../src/censosPortalWorkersCurrent.js';

const input = JSON.parse((await fs.readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, ''));
if (input.sourceUser !== '72683' || !Number.isFinite(Date.parse(input.capturedAt))
  || input.cards?.length !== 2) throw new Error('Se requieren los dos censos de la cuenta personal 72683.');
const names = ['CONDUCTOR 1a', 'CONDUCTOR 2a'];
const cards = names.map((name) => {
  const rows = input.cards.filter((card) => card.name === name);
  if (rows.length !== 1) throw new Error(`Falta un bloque único de ${name}.`);
  const item = rows[0];
  const censo = item.chapas || item.raw?.trim().split(/\s+/);
  if (!Array.isArray(censo) || censo.length !== item.declared || censo.length < 400
    || censo.some((chapa) => !/^\d{5}$/.test(chapa)) || new Set(censo).size !== censo.length)
    throw new Error(`Censo incompleto o duplicado: ${name}.`);
  const previous = capture.cards.find((card) => card.name === name);
  if (Date.parse(input.capturedAt) < Date.parse(previous.capturedAt)) throw new Error(`Captura antigua: ${name}.`);
  const keys = { Lab: 'LAB', Noc: 'NOC', NocFes: 'NOC-FES', Fes: 'FES' };
  const doors = previous.doors.map((door) => {
    const raw = item.doors[Object.keys(keys).find((key) => keys[key] === door.key)];
    if (!censo.includes(String(raw))) throw new Error(`Puerta sin posición: ${name} ${door.key}.`);
    return { ...door, raw: Number(raw) };
  });
  return { ...previous, censo, doors, expectedSize: censo.length,
    previousCenso: censo.join(',') === previous.censo.join(',') ? previous.previousCenso || [] : previous.censo,
    capturedAt: input.capturedAt, sourceUser: input.sourceUser };
});
const updated = { ...capture, capturedAt: input.capturedAt,
  cards: capture.cards.map((card) => cards.find((item) => item.id === card.id) || card) };
await fs.writeFile(new URL('../src/censosPortalWorkersCurrent.js', import.meta.url),
  `// Capturas verificadas del Chapero por especialidades. Fecha y origen por bloque; sin enlaces ni credenciales.\nexport default ${JSON.stringify(updated, null, 2)};\n`);
for (const card of cards) console.log(`${card.name}: ${card.expectedSize} trabajadores; origen personal ${card.sourceUser}.`);
