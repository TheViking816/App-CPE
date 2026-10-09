import test from 'node:test';
import assert from 'node:assert/strict';
import { canRespondToVacationOffer } from '../src/vacationExchange.js';
import { PROFESSIONAL_GROUPS, professionalGroupCode, professionalGroupLabel } from '../src/professionalGroups.js';

const offer = {
  status: 'open', isOwn: false,
  offeredStart: '2099-01-01', offeredEnd: '2099-01-01',
  wantedStart: '2099-01-02', wantedEnd: '2099-01-02',
  professionalGroup: '(G-D ) - CONTAINERA - RTT'
};

test('portal professional groups are matched by code for vacation exchanges', () => {
  assert.equal(professionalGroupCode(offer.professionalGroup), 'G-D');
  assert.match(professionalGroupLabel('G-III'), /Clasificadores/);
  assert.match(professionalGroupLabel('SIN-F'), /conductores/);
  assert.match(professionalGroupLabel('G-IV'), /Capataces/);
  assert.match(professionalGroupLabel('G-B'), /Móvil/);
  assert.equal(new Set(PROFESSIONAL_GROUPS.map((group) => group.code)).size, 11);
  assert.equal(PROFESSIONAL_GROUPS.some((group) => group.code === 'G-II'), false);
  assert.equal(canRespondToVacationOffer(offer, 'G-D'), true);
  assert.equal(canRespondToVacationOffer(offer, 'G-DA'), false);
  assert.equal(canRespondToVacationOffer(offer, ''), false);
  assert.equal(canRespondToVacationOffer({ ...offer, professionalGroup: null }, 'G-D'), false);
});
