import assert from 'node:assert/strict';
import test from 'node:test';
import capture from '../src/censosPortalWorkersCurrent.js';
import { findByChapa, getDoorState, getSpecialty, specialties, validateSpecialtyCenso } from '../src/censo.js';

const totals = {
  'conductor-1a': 613, 'conductor-2a': 529, clasificador: 203,
  'trastainers-rtt': 668, 'pol-conductor-1a': 457, 'pol-conductor-2a': 489,
  'pol-especialista': 1339, 'pol-trincador': 602, 'pol-trinca-coches': 152,
  mafis: 84, 'apoyo-operacion': 333, container: 412,
  'pol-capataz': 44, 'pol-sobordista': 48, 'pol-elevadoras': 129
};

test('las capturas actuales contienen los quince censos completos sin credenciales', () => {
  assert.deepEqual(new Set(capture.sourceUsers), new Set(['72683', '71206', '72509', '63178']));
  assert.match(capture.capturedAt, /^2026-10-22T/);
  for (const card of capture.cards) {
    assert.match(card.capturedAt, /^2026-10-22T/);
    assert.ok(capture.sourceUsers.includes(card.sourceUser));
    assert.equal(card.portalType, card.name.startsWith('POL.') ? 'TP' : 'TU');
  }
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
    ['conductor-1a', '72745', 51], ['conductor-2a', '72745', 47],
    ['pol-trincador', '72748', 13], ['pol-trinca-coches', '72749', 2],
    ['pol-especialista', '72788', 414]
  ]) assert.equal(findByChapa(chapa, id)?.position, position);
  assert.equal(findByChapa('72745', 'pol-trincador'), null);
  assert.equal(findByChapa('72745', 'pol-trinca-coches'), null);
});

test('la puerta Super 71026 tiene posición y distancia en conductor de primera', () => {
  assert.equal(findByChapa('71026', 'conductor-1a')?.position, 297);
  const door = getDoorState('72683', [{ key: 'NOC', raw: 71026 }], 'conductor-1a')[0];
  assert.equal(door.doorPosition, 297);
  assert.equal(door.userPosition, 77);
  assert.equal(door.distance, 393);
});
