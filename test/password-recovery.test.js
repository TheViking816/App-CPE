import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryHandler, GENERIC_MESSAGE } from '../supabase/functions/app-cpe-password-recovery/handler.js';

const token = 'a'.repeat(64);
const request = (body, options = {}) => new Request('https://example.test/recovery', {
  method: 'POST', headers: { origin: 'https://cpe-app-flax.vercel.app', 'Content-Type': 'application/json', 'x-forwarded-for': '192.0.2.1' }, body: JSON.stringify(body), ...options
});
const handler = (rpc, sendEmail = async () => {}) => createRecoveryHandler({ db: { rpc }, sendEmail, ipSalt: 'test-salt' });

test('unknown accounts and rate limits have the same generic response', async () => {
  const response = await handler(async (name, args) => {
    assert.equal(name, 'app_cpe_issue_password_reset');
    assert.match(args.p_ip_hash, /^[a-f0-9]{64}$/);
    assert.ok(!args.p_ip_hash.includes('192.0.2.1'));
    return { data: null };
  })(request({ action: 'request', chapa: '12345' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, message: GENERIC_MESSAGE });
});

test('only the saved email is sent to the internal mail service; token never reaches the public response', async () => {
  let message;
  const response = await handler(async () => ({ data: { email: 'owner@example.test', token } }), async (value) => { message = value; })(request({ action: 'request', chapa: '12345', email: 'attacker@example.test' }));
  assert.deepEqual(message, { to: 'owner@example.test', token });
  assert.equal((await response.text()).includes(token), false);
});

test('delivery failures cancel the token and keep the generic public response', async () => {
  const calls = [];
  const response = await handler(async (name, args) => {
    calls.push([name, args]);
    return name === 'app_cpe_issue_password_reset' ? { data: { email: 'owner@example.test', token } } : { data: null };
  }, async () => { throw new Error('SMTP failure'); })(request({ action: 'request', chapa: '12345' }));
  assert.equal(calls[1][0], 'app_cpe_cancel_password_reset');
  assert.equal(calls[1][1].p_token, token);
  assert.equal(response.status, 200);
});

test('invalid input, short passwords, bcrypt overflow, malformed JSON, and foreign origins are rejected before SQL', async () => {
  const run = handler(async () => assert.fail('must not query SQL'));
  for (const body of [{ action: 'request', chapa: 'x' }, { action: 'reset', token: 'bad', password: 'longpassword' }, { action: 'reset', token, password: 'short' }, { action: 'reset', token, password: 'ñ'.repeat(37) }, null]) {
    assert.equal((await run(request(body))).status, 400);
  }
  assert.equal((await run(request({}, { body: '{' }))).status, 400);
  assert.equal((await run(request({}, { headers: { origin: 'https://attacker.test' } }))).status, 403);
});

test('expired or reused tokens fail, valid tokens update successfully', async () => {
  const body = { action: 'reset', token, password: 'strong-password' };
  assert.equal((await handler(async () => ({ data: false }))(request(body))).status, 400);
  const response = await handler(async (name, args) => {
    assert.equal(name, 'app_cpe_reset_password');
    assert.equal(args.p_password, body.password);
    return { data: true };
  })(request(body));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('database errors return a retryable failure without leaking details', async () => {
  const response = await handler(async () => ({ error: new Error('internal secrets') }))(request({ action: 'request', chapa: '12345' }));
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('internal secrets'), false);
});
