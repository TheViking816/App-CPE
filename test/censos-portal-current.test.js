import assert from 'node:assert/strict';
import test from 'node:test';
import capture from '../src/censosPortalWorkersCurrent.js';
import { findByChapa, getDoorState, getSpecialty, specialties, validateSpecialtyCenso } from '../src/censo.js';

const totals = {
  'conductor-1a': 613, 'conductor-2a': 537, clasificador: 203,
  'trastainers-rtt': 668, 'pol-conductor-1a': 457, 'pol-conductor-2a': 489,
  'pol-especialista': 1339, 'pol-trincador': 602, 'pol-trinca-coches': 152,
  mafis: 84, 'apoyo-operacion': 333, container: 412,
  'pol-capataz': 44, 'pol-sobordista': 48, 'pol-elevadoras': 129
};

test('las capturas actuales contienen los quince censos completos sin credenciales', () => {
  assert.deepEqual(new Set(capture.sourceUsers), new Set(['72683', '71206', '72509', '63178']));
  assert.match(capture.capturedAt, /^2026-11-07T/);
  for (const card of capture.cards) {
    assert.match(card.capturedAt, /^conductor-/.test(card.id) ? /^2026-11-07T/ : /^2026-10-22T/);
    if (/^conductor-/.test(card.id)) assert.equal(card.sourceUser, '72683');
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
    ['conductor-1a', '72745', 47], ['conductor-2a', '72745', 45],
    ['pol-trincador', '72748', 13], ['pol-trinca-coches', '72749', 2],
    ['pol-especialista', '72788', 414]
  ]) assert.equal(findByChapa(chapa, id)?.position, position);
  assert.equal(findByChapa('72745', 'pol-trincador'), null);
  assert.equal(findByChapa('72745', 'pol-trinca-coches'), null);
});

test('las puertas ausentes de la captura vuelven a tener distancia exacta en segunda', () => {
  const doors = getDoorState('72683', [{ key: 'NOC', raw: 71658 }, { key: 'LAB', raw: 71773 }], 'conductor-2a');
  assert.deepEqual(doors.map(door => [door.doorChapa, door.doorPosition, door.distance, door.estimated]),
    [['71658', 136, 470, false], ['71773', 179, 427, false]]);
  assert.equal(doors[0].userPosition, 69);
});

test('solo Lab cuenta no contratados delante; Noc y festivas conservan la distancia total', () => {
  const doors = [
    { key: 'LAB', raw: 72543, dayType: 'laborable' },
    { key: 'NOC', raw: 71719, dayType: 'laborable' },
    { key: 'FES', raw: 72504, dayType: 'festivo' }
  ];
  const workers = [
    { chapa: '72678', status: 'nocontratado' },
    { chapa: '72749', status: 'contratado' },
    { chapa: '72751', status: 'nocontratado' },
    { chapa: '72752', status: 'falta' }
  ];
  const result = getDoorState('72683', doors, 'conductor-1a', workers);
  assert.equal(result.find((door) => door.key === 'LAB').distance, 2);
  assert.equal(result.find((door) => door.key === 'LAB').totalDistance, 579);
  assert.equal(result.find((door) => door.key === 'NOC').distance, result.find((door) => door.key === 'NOC').totalDistance);
  assert.equal(result.find((door) => door.key === 'FES').distance, result.find((door) => door.key === 'FES').totalDistance);
  assert.equal(getDoorState('72683', doors, 'conductor-1a', null).find((door) => door.key === 'LAB').distance, null);
  assert.equal(getDoorState('72683', doors, 'conductor-1a', null).find((door) => door.key === 'NOC').distance, result.find((door) => door.key === 'NOC').totalDistance);
});
