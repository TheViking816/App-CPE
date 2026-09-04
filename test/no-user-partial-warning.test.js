import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('la pantalla del usuario no muestra diagnósticos internos de sync parcial', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.equal(app.includes('Lectura parcial: se conservan tus datos anteriores'), false);
  assert.equal(app.includes('(payload.sync.warnings || []).map'), false);
  assert.ok(app.includes('selectPremiumRowsForMonth'));
});
