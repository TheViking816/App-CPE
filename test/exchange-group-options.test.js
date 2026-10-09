import test from 'node:test';
import assert from 'node:assert/strict';
import { REST_GROUPS, restGroupCode } from '../src/restGroups.js';
import { PROFESSIONAL_GROUPS, professionalGroupCode } from '../src/professionalGroups.js';

test('exchange filters include every supported rest and professional group', () => {
  assert.deepEqual(REST_GROUPS, ['A - N', 'A - V', 'B - N', 'B - V', 'C - N', 'C - V']);
  assert.equal(PROFESSIONAL_GROUPS.length, 11);
  assert.equal(restGroupCode('A-V'), 'A - V');
  assert.equal(restGroupCode('C - N'), 'C - N');
  assert.equal(professionalGroupCode('(G-DA) Solo RTT'), 'G-DA');
});
