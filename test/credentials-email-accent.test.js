import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('el detector SQL reconoce el mensaje real del worker y la variante sin ñ', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260904130834_recognize_accented_credentials_error.sql', import.meta.url), 'utf8');
  const pattern = sql.match(/new\.message ~\* '([^']+)'/)[1];
  const detector = new RegExp(pattern.replaceAll('[[:space:]]', '\\s'), 'i');
  const worker = readFileSync(new URL('../scripts/sync-portal-oficial-job.js', import.meta.url), 'utf8');
  const actual = worker.match(/return "(Usuario o contraseña del portal oficial incorrectos\.)"/)[1];
  assert.ok(detector.test(actual));
  assert.ok(detector.test(actual.replace('ñ', 'n')));
  assert.equal(detector.test('Cloudflare: tiempo de espera agotado'), false);
  assert.equal(detector.test('Las claves del Portal siguen pendientes de corrección; el usuario ya fue avisado.'), false);
  assert.ok(sql.includes('on conflict (user_id, kind) do nothing'));
  assert.ok(sql.includes("new.status = 'failed'"));
});
