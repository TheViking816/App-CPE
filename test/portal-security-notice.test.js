import test from 'node:test';
import assert from 'node:assert/strict';
import { needsPortalSecurityKey } from '../src/portalSecurityNotice.js';

test('shows rejected key notice despite preserved unlocked data (71898)', () => {
  assert.equal(needsPortalSecurityKey({primas:{locked:false},sync:{notices:['Clave de primas incorrecta: primas y nominas pendientes de actualizar; se conservan los datos guardados.']}}), true);
});
test('shows missing key notice even with unrelated failure or no partial flag', () => {
  assert.equal(needsPortalSecurityKey({sync:{failed:true,notices:['Primas y nominas pendientes de introducir la clave de seguridad.']}}),true);
  assert.equal(needsPortalSecurityKey({nominas:{locked:true}}),true);
});
test('does not show notice after a clean successful read or an unrelated warning', () => {
  assert.equal(needsPortalSecurityKey({sync:{notices:[],warnings:['Vacaciones conservadas']},primas:{locked:false}}),false);
});
