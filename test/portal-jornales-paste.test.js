import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePortalJornalesPaste, planPortalJornalesImport } from '../src/portalJornalesPaste.js';
import { buildManualSalaryMonths } from '../src/manualSalary.js';
import { packManualNotes, unpackManualNotes } from '../src/manualMetadata.js';

const header = '#\tParte\tDia\tTipo\tJornada\tEspecialidad\tEmpresa\tBuque\tOperacion\tProd.';
const line = (number, part, day, shift, premium = '') =>
  `${number}\t${part}\t${day}\tTUR\tDE ${shift.replace('-', ' A ')} H.\tCONDUCTOR 1a\tTerminal Ejemplo\tBUQUE DE PRUEBA\tCONT. C/SPREADER AUT\t${premium}`;
const paste = (rows, hidden = false) => `Octubre 2026\nHoy\n${hidden ? 'Para ver las primas, pulsa el ojo e introduce tu clave de seguridad\n' : ''}Jornales del mes: ${rows.length}\nVersión móvil\n${header}\n${rows.join('\n')}`;

test('interpreta filas copiadas con y sin primas y conserva sus campos', () => {
  const visible = parsePortalJornalesPaste(paste([line(1, '12001', 3, '08-14', '146,82€')]));
  assert.deepEqual(visible.errors, []);
  assert.equal(visible.rows[0].work_date, '2026-10-03');
  assert.equal(visible.rows[0].shift, '08-14');
  assert.equal(visible.rows[0].worker_group, 'II');
  assert.equal(visible.rows[0].premium, 146.82);
  const hidden = parsePortalJornalesPaste(paste([line(1, '12001', 3, '08-14')], true));
  assert.equal(hidden.premiumsHidden, true);
  assert.equal(hidden.premiumsPending, 1);
  assert.equal(hidden.rows[0].premium, null);
});

test('rechaza una copia incompleta antes de guardar', () => {
  const text = paste([line(1, '12001', 3, '08-14')]).replace('Jornales del mes: 1', 'Jornales del mes: 2');
  assert.match(parsePortalJornalesPaste(text).errors.join(' '), /Copia el mes completo/);
});

test('lee un mes completo con 24 filas, dobles y primas no publicadas', () => {
  const rows = Array.from({ length: 24 }, (_, index) => line(index + 1, String(12001 + index), Math.min(index + 1, 30), '02-08', index === 23 ? '—' : '10,00€'));
  rows[1] = '2\t12002\t1\tNUD\tDE 20 A 02 H.\tCONDUCTOR 1a\tTerminal Ejemplo\tBUQUE DE PRUEBA\tCONT. C/SPREADER AUT\t12,50€';
  const parsed = parsePortalJornalesPaste(paste(rows));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 24);
  assert.equal(parsed.rows[1].shift, '20-02');
  assert.equal(parsed.rows[1].portalType, 'NUD');
  assert.equal(parsed.rows[23].premium, null);
  assert.equal(planPortalJornalesImport(parsed).newCount, 24);
});

test('evita duplicados y completa una prima oculta al pegar de nuevo', () => {
  const hidden = parsePortalJornalesPaste(paste([line(1, '12001', 3, '08-14')], true));
  const first = planPortalJornalesImport(hidden);
  assert.equal(first.newCount, 1);
  const row = { id: 'importado-1', work_date: '2026-10-03', shift: '08-14', specialty: 'CONDUCTOR 1a',
    worker_group: 'II', operation_type: 'ESTIBA', premium: 0,
    notes: packManualNotes({ ...hidden.rows[0], source: 'portal_paste', premiumKnown: false }) };
  const existing = buildManualSalaryMonths(null, [row])[0].items;
  assert.equal(existing[0].payroll.primaPending, true);
  assert.equal(planPortalJornalesImport(hidden, existing, [row]).existingCount, 1);
  const visible = parsePortalJornalesPaste(paste([line(1, '12001', 3, '08-14', '146,82€')]));
  const upgrade = planPortalJornalesImport(visible, existing, [row]);
  assert.equal(upgrade.newCount, 0);
  assert.equal(upgrade.premiumUpdates, 1);
  assert.equal(upgrade.actions[0].original.id, row.id);
  assert.equal(unpackManualNotes(row.notes).source, 'portal_paste');
});

test('reconoce un jornal ya presente en el historial y no lo duplica', () => {
  const parsed = parsePortalJornalesPaste(paste([line(1, '12001', 3, '08-14', '146,82€')]));
  const snapshot = { payload: { jornales: { monthLabel: 'Octubre de 2026', rows: [{ dia: '3', parte: '12001', jornada: '08-14', especialidad: 'CONDUCTOR 1a', operacion: 'ESTIBA' }] } } };
  const existing = buildManualSalaryMonths(snapshot)[0].items;
  const plan = planPortalJornalesImport(parsed, existing);
  assert.equal(plan.newCount, 0);
  assert.equal(plan.existingCount, 1);
});
