import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonalPortalImport } from '../src/personalPortalImport.js';
import handler from '../api/noray-section.js';
const url = 'https://norayweb.cpevalencia.com/descansos?cal=gwt&mode=PROD&req=login&usr=72683&rec=2611&pwd=' + 'a'.repeat(64);
const payload = { version:1, chapa:'72683', enlaces:[{seccion:'/descansos',url}] };
test('imports exact links for 72683 without inventing links for other sections', () => {
  assert.deepEqual(parsePersonalPortalImport(JSON.stringify(payload),'72683'),payload);
  assert.throws(()=>parsePersonalPortalImport(JSON.stringify(payload),'72711'));
  for (const bad of [url.replace('72683','72711'),url.replace('norayweb.cpevalencia.com','example.com'),url+'&usr=72683',url+'#fragment',url.replace('2611','0'),url.replace('pwd=','extra=')]) {
    assert.throws(()=>parsePersonalPortalImport(JSON.stringify({...payload,enlaces:[{seccion:'/descansos',url:bad}]}),'72683'));
  }
  assert.throws(()=>parsePersonalPortalImport(JSON.stringify({...payload,enlaces:[...payload.enlaces,...payload.enlaces]}),'72683'));
});
test('relay uses the exact imported section first and keeps the credential out of the body', async () => {
  const oldFetch=globalThis.fetch, oldKey=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key';
  const requests=[];
  globalThis.fetch=async (endpoint,options)=>{requests.push(endpoint);return {ok:true,json:async()=>url};};
  try {
    const r={headers:{},setHeader(k,v){this.headers[k]=v;},end(v=''){this.body=v;}};
    await handler({method:'POST',body:{token:'session',section:'descansos'},headers:{}},r);
    assert.equal(r.statusCode,303);assert.equal(r.headers.location,url);assert.equal(r.body,'');
    assert.equal(requests.length,1);assert.match(requests[0],/app_cpe_get_imported_portal_link$/);
  } finally {globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;else process.env.VITE_SUPABASE_PUBLISHABLE_KEY=oldKey;}
});
