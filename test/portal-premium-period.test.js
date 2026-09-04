import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPremiumRowsForMonth } from '../src/portal-premium-period.js';
test('agosto conservado no usa septiembre vacío', () => {
  const section = {monthLabel:'Septiembre de 2026',rows:[],history:[{monthLabel:'Agosto de 2026',rows:[{parte:'24761',produccion:'110.96 €'}]}]};
  assert.equal(selectPremiumRowsForMonth(section,'Agosto de 2026')[0].produccion,'110.96 €');
  assert.deepEqual(selectPremiumRowsForMonth(section,'Septiembre de 2026'),[]);
});
test('fila actual vacía no oculta importe del histórico', () => {
  assert.equal(selectPremiumRowsForMonth({monthLabel:'Agosto de 2026',rows:[{parte:'1',produccion:''}],history:[{monthLabel:'Agosto de 2026',rows:[{parte:'1',produccion:'20 €'}]}]},'Agosto de 2026')[0].produccion,'20 €');
});
