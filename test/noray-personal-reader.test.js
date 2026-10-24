import test from 'node:test';
import assert from 'node:assert/strict';
import { readPersonalNoraySnapshot } from '../scripts/noray-personal-reader.js';

test('la lectura personal envía la chapa en cada autenticación y reúne las tres secciones', async () => {
  let authCount = 0;
  const page = {
    goto: async () => ({ status: () => 200 }),
    getByText: () => ({ first: () => ({ waitFor: async () => {} }) }),
    evaluate: async (_callback, input) => {
      if (input.usr !== undefined) {
        assert.deepEqual(input, { usr: '72584', rec: '2611', pwd: 'a'.repeat(64) });
        authCount += 1;
        return { status: 200, body: { intranet_access_token: 'test', local_access_token: 'test' } };
      }
      if (input.endpoint.includes('/cabecera/')) return { status: 200, body: {} };
      if (input.endpoint.includes('/descansos/') && input.endpoint.includes('/mes/'))
        return { status: 200, body: { anyo: 2026, mes: 10, dias: [] } };
      if (input.endpoint.includes('/trabajadores/')) return { status: 200, body: {} };
      if (input.endpoint.includes('/vacaciones/')) return { status: 200, body: { anyo: 2026, periodos: [] } };
      return { status: 200, body: { jornales: [] } };
    }
  };
  const snapshot = await readPersonalNoraySnapshot(page,
    { chapa: '72584', rec: '2611', pwd: 'a'.repeat(64) }, { year: 2026, month: 10, pauseMs: 0 });
  assert.equal(authCount, 3);
  assert.equal(snapshot.chapa, '72584');
  assert.deepEqual(snapshot.journals.rows, []);
  assert.deepEqual(snapshot.rests.days, []);
  assert.deepEqual(snapshot.vacations.periods, []);
});
