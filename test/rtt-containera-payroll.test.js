import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichJornales, getRelayHourKey, getSpecialtyKey, summarizeAnnualPayroll } from '../src/payroll.js';
import { buildManualSalaryMonths } from '../src/manualSalary.js';

// Each row transcribed independently from the supplied operation-unique table.
const rows = [
  [13, '02-08', 297.97], [17, '02-08', 348.54],
  [15, '02-08', 536.26, 469.13], [16, '02-08', 584.93, 511.60],
  [13, '06-12', 215.28], [13, '08-14', 151.92], [8, '08-14', 168.39],
  [15, '08-14', 273.51, 231.75], [13, '14-20', 151.92],
  [8, '14-20', 273.51, 231.75], [15, '14-20', 387.29, 328.17],
  [13, '20-02', 227.93], [14, '20-02', 288.69],
  [8, '20-02', 402.20, 340.81], [9, '20-02', 461.81, 391.29],
  [15, '20-02', 521.37, 441.77]
];
const round = (value) => Number(value.toFixed(2));
for (const specialty of ['TRASTAINERS RTT', 'CONTAINERA']) {
  for (const [day, shift, withRE, withoutRE] of rows) {
    test(`${specialty}: agosto ${day}, ${shift}, con y sin R/E`, () => {
      for (const operation of ['ESTIBA', 'RECEPCION / ENTREGA']) {
        const raw = { dia: day, jornada: shift, especialidad: specialty, operacion: operation, parte: '1234', produccion: '42,50' };
        const date = `2026-08-${String(day).padStart(2, '0')}`;
        const key = `${date}|${shift}|${getSpecialtyKey(specialty)}`;
        const manual = { [getRelayHourKey(raw, date, shift)]: { amount: 42.5 } };
        for (const answer of [true, false]) {
          const calculated = enrichJornales([raw], [], 'Agosto de 2026', {
            rates: [{ operation_type: 'ESTIBA', worker_group: 'II', rate_key: 'LABORABLE', shift_key: shift, amount: 1 }],
            complements: [{ specialty_key: getSpecialtyKey(specialty), festivo: 999, servicio_publico_08_14: 999 }]
          }, {}, {}, manual, { [key]: answer })[0].payroll;
          const expected = !answer && withoutRE != null ? withoutRE : withRE;
          assert.equal(calculated.base, expected);
          assert.equal(calculated.complement, 56.96);
          assert.equal(calculated.prima, 42.5);
          assert.equal(calculated.total, round(expected + 56.96 + 42.5));
          assert.equal(calculated.receptionEligible, withoutRE != null);
          assert.equal(calculated.receptionPending, false);
        }
      }
    });
  }
}

test('sin respuesta, usa estimación sin R/E y señala que falta responder', () => {
  const raw = { dia: 15, jornada: '08-14', especialidad: 'TRANSTAINER', parte: '1' };
  const payroll = enrichJornales([raw], [], 'Agosto de 2026')[0].payroll;
  assert.equal(payroll.base, 231.75);
  assert.equal(payroll.total, 288.71);
  assert.equal(payroll.receptionPending, true);
  assert.equal(payroll.receptionChoice, null);
});

test('RTT y containera esperan la prima manual aunque portal, Noray o primas compartidas tengan importes', () => {
  const row = { dia: 15, jornada: '08-14', especialidad: 'CONTAINERA', parte: '1234', produccion: '999,00' };
  const snapshot = { payload: {
    jornales: { monthLabel: 'Agosto de 2026', rows: [row] },
    primas: { monthLabel: 'Agosto de 2026', rows: [{ parte: '1234', produccion: '999,00' }] },
    norayPremiumsBySlot: { '2026-08-15|08-14': { amount: 999 } }
  } };
  const initial = buildManualSalaryMonths(snapshot)[0].items[0];
  const key = initial.payroll.manualPremiumKey;
  const pending = buildManualSalaryMonths(snapshot, [], null, {}, {}, {}, [], { [key]: 999 })[0].items[0];
  assert.equal(pending.payroll.prima, null);
  assert.equal(pending.payroll.primaPending, true);
  const saved = buildManualSalaryMonths(snapshot, [], null, { [key]: { amount: 0 } })[0].items[0];
  assert.equal(saved.payroll.prima, 0);
  assert.equal(saved.payroll.primaPending, false);
  assert.equal(saved.payroll.primaSource, 'manual');
  const manual = buildManualSalaryMonths(snapshot, [{ id: 'manual', work_date: '2026-08-15', shift: '08-14', specialty: 'TRASTAINERS RTT', worker_group: 'II', operation_type: 'RECEPCION_ENTREGA', premium: 42.5 }])[0].items.find((item) => item.source === 'manual');
  assert.equal(manual.payroll.prima, 42.5);
  assert.equal(manual.payroll.primaSource, 'manual');
  const replacement = buildManualSalaryMonths({ payload: { ...snapshot.payload, norayJournalSlots: ['2026-08-15|08-14'] } },
    [{ id: 'replaced', work_date: '2026-08-15', shift: '08-14', specialty: 'CONTAINERA', premium: 42.5 }])[0].items;
  assert.equal(replacement.length, 1);
  assert.equal(replacement[0].payroll.prima, 42.5);
  assert.equal(replacement[0].payroll.primaSource, 'manual');
});

test('la elección se conserva al cambiar el parte y llega al historial, manuales y resumen anual', () => {
  const row = { dia: 15, jornada: '14-20', especialidad: 'CONTAINERA', parte: '456', produccion: '20,00' };
  const choices = { '2026-08-15|14-20|CONTAINER': true };
  const manualPremiums = { [getRelayHourKey(row, '2026-08-15', '14-20')]: { amount: 20 } };
  const history = [{ year: 2026, month: 8, monthLabel: 'Agosto de 2026', rows: [row] }];
  const historical = buildManualSalaryMonths({ payload: { jornales: { history } } }, [], null, manualPremiums, {}, {}, [], {}, choices)[0].items[0];
  assert.equal(historical.payroll.total, 464.25);
  assert.equal(historical.payroll.receptionChoice, true);
  const manual = buildManualSalaryMonths(null, [{ id: 'manual-1', work_date: '2026-08-15', shift: '14-20', specialty: 'CONTAINERA', worker_group: 'II', operation_type: 'ESTIBA', premium: 20 }], null, {}, {}, {}, [], {}, choices)[0].items[0];
  assert.equal(manual.payroll.total, historical.payroll.total);
  assert.equal(manual.payroll.receptionPending, false);
  const annual = summarizeAnnualPayroll(history, null, {}, [], [], {}, manualPremiums, [], choices);
  assert.equal(annual.months[0].enriched[0].payroll.total, 464.25);
  assert.equal(enrichJornales([{ ...row, parte: '789' }], [], 'Agosto de 2026', null, {}, {}, {}, choices)[0].payroll.base, 387.29);
});

