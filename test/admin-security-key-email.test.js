import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20260904131811_admin_security_key_email.sql', import.meta.url), 'utf8');

test('avisa una sola vez al administrador al añadir la primera clave de primas', () => {
  assert.ok(sql.includes('old.security_key_secret_id is null'));
  assert.ok(sql.includes('new.security_key_secret_id is not null'));
  assert.ok(sql.includes('old.portal_password_secret_id is not null'));
  assert.ok(sql.includes("portal_activation_status = 'active'"));
  assert.ok(sql.includes("'admin_security_key_added'"));
  assert.ok(sql.includes("'portalestibavlc@gmail.com'"));
  assert.ok(sql.includes('on conflict (user_id, kind) do nothing'));
});
