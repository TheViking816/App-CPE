import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

test('avisos seguidos comparten una sola tarjeta y conservan sus enlaces', async () => {
  const handlers = new Map();
  let visible = [];
  const registration = {
    scope: 'https://example.test/',
    async getNotifications({ tag }) { return visible.filter((item) => item.tag === tag); },
    async showNotification(title, options) {
      visible = visible.filter((item) => item.tag !== options.tag);
      visible.push({ title, ...options });
    }
  };
  const self = {
    registration,
    addEventListener(name, handler) { handlers.set(name, handler); }
  };
  vm.runInNewContext(readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8'), { self, Promise, Date, URL, caches: {} });
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333'
  ];
  for (const id of ids) {
    let finished;
    handlers.get('push')({
      data: { json: () => ({ notificationId: id, title: 'Prima cargada', body: 'Se ha cargado una prima.' }) },
      waitUntil(promise) { finished = promise; }
    });
    await finished;
  }
  assert.equal(visible.length, 1);
  assert.equal(visible[0].title, '3 novedades en App CPE');
  assert.equal(visible[0].renotify, false);
  assert.deepEqual(Array.from(visible[0].data.ids), ids);
  assert.match(visible[0].data.url, /#\/novedades\?source=push&ids=/);
});
