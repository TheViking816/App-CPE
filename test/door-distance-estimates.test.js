import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateDoorReference, getDoorState, getSpecialty } from '../src/censo.js';
import { doorDistanceLabel } from '../src/doorDistanceLabel.js';

const rows = (...chapas) => chapas.map((chapa, index) => ({ chapa, position: index + 1 }));

test('estima por vecinos consecutivos y respeta el salto circular', () => {
  const censo = rows('71001', '71003', '71004');
  assert.deepEqual(estimateDoorReference('71002', censo, [['71001', '71002', '71003', '71004']]),
    { chapa: '71003', position: 2, estimated: true });
  assert.equal(estimateDoorReference('71002', censo, [['71002', '71001', '71003', '71004']]).chapa, '71001');
});

test('no deduce el orden por números ni estima con referencias incompatibles', () => {
  assert.equal(estimateDoorReference('71002', rows('71001', '71003', '71004'), []), null);
  assert.equal(estimateDoorReference('71002', rows('71003', '71001', '71004'), [['71001', '71002', '71003', '71004']]), null);
  assert.equal(estimateDoorReference('71002', [], [['71001', '71002', '71003']]), null);
});

test('una puerta ausente conserva distancia estimada, cuenta al siguiente y no inventa estados', () => {
  const specialty = getSpecialty('conductor-2a');
  const original = specialty.censo;
  try {
    specialty.censo = rows(...original.map(row => row.chapa).filter(chapa => chapa !== '72749'));
    const doors = [{ key: 'NOC', raw: 72749 }, { key: 'LAB', raw: 72749 }];
    const result = getDoorState('72683', doors, specialty.id, [{ chapa: '72751', status: 'nocontratado' }]);
    assert.ok(result.every(door => door.estimated && door.referenceChapa === '72751' && Number.isInteger(door.distance)));
    assert.equal(result.find(door => door.key === 'LAB').distance, 1);
    assert.equal(getDoorState('72683', doors, specialty.id, null).find(door => door.key === 'LAB').distance, null);
    assert.equal(getDoorState('72683', [{ key: 'NOC', raw: 79999 }], specialty.id)[0].distance, null);
  } finally { specialty.censo = original; }
});

test('cero muestra Estás en puerta; una estimación nunca afirma una posición exacta', () => {
  assert.equal(doorDistanceLabel(0), 'Estás en puerta');
  assert.equal(doorDistanceLabel(0, { compact: true }), 'Estás en puerta');
  assert.equal(doorDistanceLabel(0, { estimated: true }), '≈0 posiciones');
  assert.equal(doorDistanceLabel(12, { compact: true, estimated: true }), '≈12');
  assert.equal(doorDistanceLabel(null), 'Sin dato');
});
