import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { pendingPremiumPeriods, premiumMonthsToRead } from "../scripts/sync-portal-oficial.js";

const row = (state, amount = "182.53") => ({ parte: "24640", produccionEstado: state, produccion: amount });
const period = (year, month, rows) => ({ year, month, monthLabel: `${month}/${year}`, rows });
test("relee pendientes anteriores, pero no confirmadas, pagadas, vacias ni futuras", () => {
  assert.deepEqual(pendingPremiumPeriods([
    period(2026, 8, [row("pending")]), period(2026, 7, [row("verified")]),
    period(2026, 6, [row("paid")]), period(2026, 5, [row("unknown", "")]),
    period(2026, 4, [row("unknown")]), period(2026, 10, [row("pending")])
  ], 2026, 9), [{year:2026, month:8}, {year:2026, month:4}]);
});
test("enero sigue revisando diciembre pendiente del año anterior", () => {
  assert.deepEqual(pendingPremiumPeriods([period(2026,12,[row("pending")])],2027,1), [{year:2026,month:12}]);
});

const source = readFileSync(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");
const collector = source.slice(source.indexOf("async function collectPrimasHistory("), source.indexOf("async function upsertSupabase("));
async function collect(read, previous, initial = { recognized:true, monthLabel:"9/2026", rows:[] }) {
  const calls = [];
  const run = vm.runInNewContext(collector + "; collectPrimasHistory", {
    Date: class extends Date { constructor() { super("2026-09-04T12:00:00Z"); } },
    process:{ env:{} }, fastMode:true, MONTH_NAMES_ES:Array.from({length:12},(_,i)=>String(i+1)+"/"),
    cleanText: value=>String(value||""), jornalesPeriodMatches:(label,m,y)=>label===`${m}/${y}`,
    pendingPremiumPeriods, premiumMonthsToRead, console:{log(){},warn(){}},
    readPrimasPeriod:async(ctx,url,m,y)=>{calls.push([y,m]);return read(y,m);}
  });
  return {result:await run({context:()=>({})}, initial, previous), calls};
}
test("modo mensual actualiza estado e importe y deja de releer al confirmar", async () => {
  const previous = {history:[period(2026,8,[row("pending")])]};
  const {result,calls} = await collect((y,m)=>period(y,m,[row("paid","180.54")]), previous);
  assert.deepEqual(calls,[[2026,8]]);
  assert.equal(result.history[0].rows[0].produccion,"180.54");
  assert.equal(result.history[0].rows[0].produccionEstado,"paid");
  assert.deepEqual((await collect(()=>{throw Error("no debe leer");},result)).calls,[]);
});
test("una lectura vacia o fallida conserva el mes pendiente y vuelve a intentarlo", async () => {
  const previous = {history:[period(2026,8,[row("pending")])]};
  for (const read of [(y,m)=>period(y,m,[]),()=>{throw Error("timeout");}]) {
    const {result}=await collect(read, previous);
    assert.equal(result.history[0].rows[0].produccion,"182.53");
    assert.equal(result.historyWarnings.length,1);
    assert.deepEqual((await collect((y,m)=>period(y,m,[row("paid")]),result)).calls,[[2026,8]]);
  }
});
