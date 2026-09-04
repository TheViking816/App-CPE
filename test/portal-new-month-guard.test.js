import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../scripts/sync-portal-oficial.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('const protectedCollectionKeys'),source.indexOf('async function writeStatus'));
const guard=vm.runInNewContext(block.replace('export function','function')+'; wouldEraseStoredCollection');
test('septiembre con menos jornales no se compara con agosto',()=>{
  assert.equal(guard({recognized:true,monthLabel:'Septiembre de 2026',rows:[{}]},{monthLabel:'Agosto de 2026',rows:[{},{},{}]}),false);
});
test('una lectura reducida del mismo mes sigue protegida',()=>{
  assert.equal(guard({recognized:true,monthLabel:'Agosto de 2026',rows:[]},{monthLabel:'Agosto de 2026',rows:[{}]}),true);
});
test('si septiembre ya existe en el histórico tampoco puede vaciarse',()=>{
  assert.equal(guard({recognized:true,monthLabel:'Septiembre de 2026',rows:[],history:[{}]},{monthLabel:'Agosto de 2026',rows:[{}],history:[{monthLabel:'Septiembre de 2026',rows:[{}]}]}),true);
});
