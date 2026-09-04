import test from "node:test";
import assert from "node:assert/strict";
import { calendarDays, calendarMonths } from "../src/portal-calendar.js";
test("72691: agosto desordenado conserva los 31 dias y sus descansos", () => {
  const codes={15:"DS",16:"DS",19:"DS",29:"FS",30:"FS"};
  const ordered=Array.from({length:31},(_,i)=>({day:i+1,code:codes[i+1]||""}));
  const shuffled=[...ordered.filter(d=>!d.code),...ordered.filter(d=>d.code)];
  const result=calendarDays({year:2026,month:8,days:shuffled});
  assert.deepEqual(result,ordered);
  assert.equal(shuffled[30].day,30);
});
test("meses ordenados sin mutar los datos originales", () => {
  const months=[{year:2027,month:1},{year:2026,month:9},{year:2026,month:8}];
  assert.deepEqual(calendarMonths(months).map(m=>m.month),[8,9,1]);
  assert.equal(months[0].year,2027);
});
test("dias duplicados no borran el descanso y dias ausentes mantienen su hueco", () => {
  const days=calendarDays({year:2026,month:9,days:[{day:"15",code:"VA"},{day:15,code:""},{day:19,code:"DS"}]});
  assert.equal(days.length,30);
  assert.equal(days[14].code,"VA");
  assert.equal(days[17].day,18);
  assert.equal(days[17].code,"");
});
test("febrero respeta años bisiestos y no crea dias 30 o 31", () => {
  assert.equal(calendarDays({year:2028,month:2}).length,29);
  assert.equal(calendarDays({year:2026,month:2}).length,28);
});
