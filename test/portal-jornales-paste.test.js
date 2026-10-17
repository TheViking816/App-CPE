import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePortalJornalesPaste, planPortalJornalesImport } from '../src/portalJornalesPaste.js';
import { buildManualSalaryMonths } from '../src/manualSalary.js';
import { packManualNotes, unpackManualNotes } from '../src/manualMetadata.js';

const header = '#\tParte\tDia\tTipo\tJornada\tEspecialidad\tEmpresa\tBuque\tOperacion\tProd.';
const line = (number, part, day, shift, premium = '') =>
  `${number}\t${part}\t${day}\tTUR\tDE ${shift.replace('-', ' A ')} H.\tCONDUCTOR 1a\tTerminal Ejemplo\tBUQUE DE PRUEBA\tCONT. C/SPREADER AUT\t${premium}`;
const paste = (rows, hidden = false) => `Octubre 2026\nHoy\n${hidden ? 'Para ver las primas, pulsa el ojo e introduce tu clave de seguridad\n' : ''}Jornales del mes: ${rows.length}\nVersión móvil\n${header}\n${rows.join('\n')}`;
const mobileCard = (number, day, part, shift, premium = '') => `Día\n${day}\nParte\n${part}\n${premium ? `${premium}\n` : ''}DE ${shift.replace('-', ' A ')} H.\nnº ${number}\nBUQUE\nBARCO DE PRUEBA\nEMPRESA\nTERMINAL DE PRUEBA\nESPEC.\nCONDUCTOR 1a\nTIPO TUR\nOPERAC.\nCONT. C/SPREADER AUT`;
const mobilePaste = (cards, hidden = false) => `Octubre 2026\nHoy\n${hidden ? 'Para ver las primas, pulsa el ojo e introduce tu clave de seguridad\n' : ''}Jornales del mes: ${cards.length}\n\nVer tabla\n\n${cards.join('\n')}`;

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
  assert.equal(plan.premiumUpdates, 1);
});

test('actualiza la prima de un jornal manual aunque ya tenga importe', () => {
  const row = { id: 'manual-1', work_date: '2026-10-03', shift: '08-14', specialty: 'CONDUCTOR 1a',
    worker_group: 'II', operation_type: 'ESTIBA', premium: 100,
    notes: packManualNotes({ company: 'Terminal Ejemplo', notes: 'Anotación propia' }) };
  const existing = buildManualSalaryMonths(null, [row])[0].items;
  const visible = parsePortalJornalesPaste(paste([line(1, '12001', 3, '08-14', '146,82€')]));
  const plan = planPortalJornalesImport(visible, existing, [row]);
  assert.equal(plan.newCount, 0);
  assert.equal(plan.premiumUpdates, 1);
  assert.equal(plan.actions[0].kind, 'premium_manual');
  assert.equal(plan.actions[0].original.id, row.id);
  assert.equal(planPortalJornalesImport(parsePortalJornalesPaste(paste([line(1, '12001', 3, '08-14', '')], true)), existing, [row]).premiumUpdates, 0);
  assert.equal(planPortalJornalesImport(parsePortalJornalesPaste(paste([line(1, '12001', 3, '08-14', '100,00€')])), existing, [row]).premiumUpdates, 0);
  assert.equal(planPortalJornalesImport(parsePortalJornalesPaste(paste([line(1, '12001', 3, '08-14', '0,00€')])), existing, [row]).premiumUpdates, 1);
});

test('actualiza la prima guardada de un jornal histórico cuando cambia en el portal', () => {
  const snapshot = { payload: { jornales: { monthLabel: 'Octubre de 2026', rows: [{
    dia: '3', parte: '12001', jornada: '08-14', especialidad: 'CONDUCTOR 1a', operacion: 'ESTIBA', produccion: '100,00€'
  }] } } };
  const original = buildManualSalaryMonths(snapshot)[0].items[0];
  const savedPremiums = { [original.payroll.manualPremiumKey]: { amount: 120, portalAmountAtEdit: 100 } };
  const existing = buildManualSalaryMonths(snapshot, [], null, savedPremiums)[0].items;
  const parsed = parsePortalJornalesPaste(paste([line(1, '12001', 3, '08-14', '146,82€')]));
  const plan = planPortalJornalesImport(parsed, existing);
  assert.equal(plan.premiumUpdates, 1);
  assert.equal(plan.actions[0].kind, 'premium_historic');
  assert.equal(plan.actions[0].item.payroll.manualPremiumKey, original.payroll.manualPremiumKey);
});

test('no duplica un jornal manual sin parte si coinciden el día y el turno', () => {
  const parsed = parsePortalJornalesPaste(paste([line(1, '12001', 3, '08-14', '146,82€')]));
  const row = { id: 'manual-sin-parte', work_date: '2026-10-03', shift: '08-14', specialty: 'CLASIFICADOR',
    worker_group: 'III', operation_type: 'ESTIBA', premium: 0, notes: packManualNotes({ company: 'Otra terminal' }) };
  const existing = buildManualSalaryMonths(null, [row])[0].items;
  const plan = planPortalJornalesImport(parsed, existing, [row]);
  assert.equal(plan.newCount, 0);
  assert.equal(plan.premiumUpdates, 1);
  assert.equal(plan.actions[0].original.id, row.id);
});

test('dos filas copiadas con el mismo día y turno se consideran un solo jornal', () => {
  const parsed = parsePortalJornalesPaste(paste([
    line(1, '12001', 3, '08-14', '10,00€'),
    line(2, '12002', 3, '08-14', '12,00€')
  ]));
  const plan = planPortalJornalesImport(parsed);
  assert.equal(plan.newCount, 1);
  assert.equal(plan.repeatedCount, 1);
});

test('lee las tarjetas copiadas desde móvil con primas y jornadas dobles', () => {
  const parsed = parsePortalJornalesPaste(mobilePaste([
    mobileCard(1, 3, '12001', '02-08', '146,82€'),
    mobileCard(2, 3, '12002', '20-02', '219,97€'),
    mobileCard(3, 4, '12003', '14-20', '—')
  ]));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].premium, 146.82);
  assert.equal(parsed.rows[1].shift, '20-02');
  assert.equal(parsed.rows[2].premium, null);
});

test('lee tarjetas móviles sin primas y detecta una copia incompleta', () => {
  const hidden = parsePortalJornalesPaste(mobilePaste([mobileCard(1, 3, '12001', '02-08')], true));
  assert.deepEqual(hidden.errors, []);
  assert.equal(hidden.premiumsHidden, true);
  assert.equal(hidden.premiumsPending, 1);
  const incomplete = mobilePaste([mobileCard(1, 3, '12001', '02-08')]).replace('Jornales del mes: 1', 'Jornales del mes: 2');
  assert.match(parsePortalJornalesPaste(incomplete).errors.join(' '), /Copia el mes completo/);
});
