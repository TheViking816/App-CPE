import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildVacationPayrollEntries,vacationPayrollEntriesForMonth,summarizePayroll,summarizeAnnualPayroll} from '../src/payroll.js';
test('septiembre sin jornales incluye siete días de vacaciones y mantiene el orden anual',()=>{
  const entries=buildVacationPayrollEntries({months:[{month:9,year:2026,days:[{day:1,code:'DS'},...Array.from({length:7},(_,i)=>({day:i+2,code:'VA'}))]}]});
  const summary=summarizePayroll(vacationPayrollEntriesForMonth(entries,'Septiembre de 2026'));
  assert.equal(summary.workCount,0);
  assert.equal(summary.vacationDays,7);
  assert.ok(summary.total>0);
  const annual=summarizeAnnualPayroll([{month:9,year:2026,monthLabel:'Septiembre de 2026',rows:[]},{month:8,year:2026,monthLabel:'Agosto de 2026',rows:[]}],null,{},entries);
  assert.deepEqual(annual.months.map(m=>m.month),[8,9]);
  assert.equal(annual.months[1].vacationDays,7);
  assert.equal(annual.months[1].total,summary.total);
});
