import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentDateKey, madridDateKey, upcomingAssignments, validateUpcomingReading } from '../src/upcomingAssignments.js';
import { readUpcomingNoray } from '../scripts/upcoming-noray-reader.js';
import { publishUpcomingPreview } from '../scripts/publish-upcoming-preview.js';

const row = { fecha: '26/10/2026', jornada: 'DE 02 A 08 H.', parte: '30964', empresa: 'CSP' };
test('upcoming excludes the past, includes all of today and crosses year/month boundaries', () => {
  const rows = upcomingAssignments({ today: '2026-12-31', reading: { rows: [{ ...row, fecha: '2026-12-30' }, { ...row, fecha: '2026-12-31' }, { ...row, fecha: '2027-01-01' }] } });
  assert.deepEqual(rows.map((item) => item.fecha), ['2026-12-31', '2027-01-01']);
  assert.equal(assignmentDateKey('20261026'), '2026-10-26');
  assert.equal(assignmentDateKey('31/02/2026'), '');
  assert.equal(madridDateKey(new Date('2026-10-25T23:30:00Z')), '2026-10-26');
});
test('same date and shift appears once, with the newly read part and team', () => {
  const rows = upcomingAssignments({ today: '2026-10-26', snapshot: { payload: { asignaciones: { rows: [row] } } }, reading: { rows: [{ ...row, parte: '30965', detail: { specialties: [{ name: 'CONDUCTOR 1a' }] } }] } });
  assert.equal(rows.length, 1); assert.equal(rows[0].parte, '30965'); assert.equal(rows[0].detail.specialties.length, 1);
});
test('a different account or mismatched/incomplete team is rejected before storage', () => {
  const detail = { recognized: true, parte: row.parte, fecha: row.fecha, jornada: row.jornada, specialties: [{ name: 'CONDUCTOR 1a', workers: [{ code: '72683', name: 'ADRIAN' }] }] };
  const data = { schemaVersion: 1, kind: 'upcoming-assignments', chapa: '72683', rows: [{ ...row, detail }] };
  assert.equal(validateUpcomingReading(data).rows.length, 1);
  assert.throws(() => validateUpcomingReading({ ...data, chapa: '72710' }), /cuenta solicitada/);
  assert.throws(() => validateUpcomingReading({ ...data, rows: [{ ...row, detail: { ...detail, parte: '1' } }] }), /no es válido/);
  assert.throws(() => validateUpcomingReading({ ...data, rows: [{ ...row, detail: { ...detail, fecha: '27/10/2026' } }] }), /no coincide/);
});
test('a portal journal appears in Mi contratación even if it was already added manually', () => {
  const saved = { ...row, fecha: '2026-10-26', parte: '', buque: '', empresa: '' };
  const reading = validateUpcomingReading({ schemaVersion: 1, kind: 'upcoming-assignments', chapa: '72683', rows: [{ ...row, parte: '30964' }] });
  const rows = upcomingAssignments({ today: '2026-10-26', snapshot: { payload: { asignaciones: { rows: [saved] } } }, reading });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].parte, '30964');
  assert.equal(rows[0].empresa, 'CSP');
});
test('manual reader uses the personal Jornales page and reads each upcoming part once', async () => {
  const calls = [];
  const page = { goto: async (url) => { calls.push(url.split('?')[0]); return { status: () => 200 }; }, getByText: () => ({ first: () => ({ waitFor: async () => {} }) }), evaluate: async (_fn, request) => {
    if (!request) return;
    if (request.usr) return { ok: true, status: 200 };
    calls.push(request.path);
    const part = request.path.includes('/partes/');
    return { status: 200, body: part ? { ...row, grupos: [{ especialidad: 'CONDUCTOR 1a', solicitados: 2, trabajadores: [{ chapa: '72683', nombre: 'ADRIAN' }, { chapa: '72684', nombre: '' }] }] } : { jornales: request.path.includes('/2026/10') ? [{ ...row, fecha: undefined, dia: 26 }, { ...row, fecha: undefined, dia: 25, parte: 100 }] : [] } };
  } };
  const result = await readUpcomingNoray(page, `https://norayweb.cpevalencia.com/jornales?usr=72683&rec=2611&pwd=${'a'.repeat(64)}&req=login&mode=PROD`, { now: new Date('2026-10-26T10:00:00Z'), pause: async () => {} });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].detail.specialties[0].workers.length, 2);
  assert.equal(calls.filter((path) => path.includes('/partes/')).length, 1);
  assert.ok(calls.some((path) => path.includes('/2026/11')));
  assert.ok(calls.every((path) => !path.includes('portal.cpevalencia.com')));
});

test('the manual publisher writes only the isolated preview channel and rejects other accounts', async () => {
  const detail = { recognized: true, parte: row.parte, fecha: row.fecha, jornada: row.jornada, specialties: [{ name: 'CONDUCTOR 1a', workers: [{ code: '72683', name: 'ADRIAN' }] }] };
  const data = { schemaVersion: 1, kind: 'upcoming-assignments', chapa: '72683', updatedAt: '2026-10-26T11:00:00Z', rows: [{ ...row, detail }] };
  const requests = [];
  await publishUpcomingPreview(data, 'test-key', { fetcher: async (url, request) => { requests.push({ url, body: JSON.parse(request.body) }); return { ok: true }; } });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.includes('/app_cpe_portal_preview_snapshots?'));
  assert.equal(requests[0].body.channel, 'upcoming-contracts-72683');
  assert.equal(requests[0].body.chapa, '72683');
  assert.deepEqual(Object.keys(requests[0].body.payload), ['upcomingAssignments']);
  await assert.rejects(publishUpcomingPreview({ ...data, chapa: '72710' }, 'test-key'), /cuenta solicitada/);
});

test('reading is accepted only for the requested owner when enabled for all accounts',()=>{const v={schemaVersion:1,kind:'upcoming-assignments',chapa:'72710',rows:[]};assert.equal(validateUpcomingReading(v,'72710').chapa,'72710');assert.throws(()=>validateUpcomingReading(v,'72683'));});
