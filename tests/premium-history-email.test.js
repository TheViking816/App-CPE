import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const sql = readFileSync(new URL('../supabase/migrations/20260904085912_premium_history_ready_email.sql', import.meta.url), 'utf8');

test('aviso solo para cuenta activa que añade por primera vez la clave pendiente', () => {
  assert.match(sql, /old.security_key_secret_id is null and new.security_key_secret_id is not null/);
  assert.match(sql, /old.portal_password_secret_id is not null/);
  assert.match(sql, /portal_activation_status='active'/);
});

test('no avisar de cargas incompletas o sin PDFs guardados', () => {
  for (const guard of ["j.status is distinct from 'completed'", "j.request_kind is distinct from 'history'", "'{sync,inProgress}'", "'{sync,partial}'", "'{sync,warnings}'", "'{primas,historyWarnings}'", "'{sync,fullHistoryCompletedAt}'", "'{nominas,locked}'", "'{nominas,recognized}'", 'public.app_cpe_portal_documents', "length(coalesce(d.content_base64,''))>0"]) {
    assert.ok(sql.includes(guard), `Falta protección: ${guard}`);
  }
});

test('aviso único y ejecución solo al terminar la tarea', () => {
  assert.match(sql, /on conflict\(user_id,kind\) do nothing/);
  assert.match(sql, /if pending_at is null then return false/);
  assert.match(sql, /new.status='completed' and old.status is distinct from new.status/);
  assert.match(sql, /set premium_history_email_pending_at=null/);
});
