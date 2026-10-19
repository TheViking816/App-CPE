import assert from 'node:assert/strict';
import test from 'node:test';
import capture from '../src/censosPortalWorkersCurrent.js';
import { findByChapa, getDoorState, getSpecialty, specialties, validateSpecialtyCenso } from '../src/censo.js';

const totals = { 'conductor-1a': 611, 'conductor-2a': 526, 'pol-trincador': 604, 'pol-trinca-coches': 152, 'pol-especialista': 1336 };

test('la captura del 19 de octubre contiene los cinco censos completos sin credenciales', () => {
  assert.equal(capture.sourceUser, '72668');
  assert.match(capture.capturedAt, /^2026-10-19T/);
  assert.deepEqual(Object.fromEntries(capture.cards.map(card => [card.id, card.expectedSize])), totals);
  assert.doesNotMatch(JSON.stringify(capture), /pwd=|password|https?:\/\//i);
  assert.equal(new Set(specialties.map(item => item.id)).size, specialties.length);
});

for (const [id, count] of Object.entries(totals)) {
  test(`${id}: todos los trabajadores pueden localizar su posición y sus cuatro distancias`, () => {
    const card = capture.cards.find(item => item.id === id);
    const specialty = getSpecialty(id);
    assert.equal(validateSpecialtyCenso(id).ok, true);
    assert.equal(specialty.censo.length, count);
    assert.deepEqual(specialty.censo.map(row => row.chapa), card.censo);
    for (const [index, chapa] of card.censo.entries()) {
      assert.equal(findByChapa(chapa, id).position, index + 1);
      assert.equal(findByChapa(chapa.slice(1), id)?.position, chapa.startsWith('7') ? index + 1 : undefined);
      const doors = getDoorState(chapa, card.doors, id);
      assert.equal(doors.length, 4);
      for (const door of doors) {
        assert.equal(door.userPosition, index + 1);
        assert.ok(door.doorPosition > 0);
        assert.equal(door.distance, (index + 1 - door.doorPosition + count) % count);
      }
    }
  });
}

test('las nuevas altas tienen las especialidades y posiciones exactas del portal', () => {
  for (const [id, chapa, position] of [
    ['conductor-1a', '72745', 3], ['conductor-2a', '72745', 1],
    ['pol-trincador', '72748', 2], ['pol-trinca-coches', '72749', 2],
    ['pol-especialista', '72788', 40]
  ]) assert.equal(findByChapa(chapa, id)?.position, position);
  assert.equal(findByChapa('72745', 'pol-trincador'), null);
  assert.equal(findByChapa('72745', 'pol-trinca-coches'), null);
});
