import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasSalaryData } from "../src/portal-salary-state.js";
import { summarizePayroll } from "../src/payroll.js";

test("72691: septiembre vacio no oculta el historico", () => {
  const section={recognized:true,monthLabel:"Septiembre de 2026",rows:[]};
  const history=[{monthLabel:"Agosto de 2026",rows:[{dia:1}]}];
  assert.equal(hasSalaryData(section,history,[]),true);
  assert.equal(summarizePayroll([]).total,0);
});
test("primer mes reconocido sin jornales muestra cero", () => {
  assert.equal(hasSalaryData({recognized:true,monthLabel:"Septiembre de 2026",rows:[]}),true);
});
test("sin conectar conserva el bloque de bienvenida", () => {
  assert.equal(hasSalaryData(null),false);
  assert.equal(hasSalaryData({recognized:false,monthLabel:"",rows:[]}),false);
});
test("vacaciones sin jornales siguen mostrando sueldometro", () => {
  assert.equal(hasSalaryData(null,[],[{code:"VA"}]),true);
});
test("la pantalla y el bloque vacio usan condiciones complementarias", () => {
  const source=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
  assert.ok(source.includes('(view === "all" || view === "salary") && showSalary'));
  assert.ok(source.includes('view === "salary" && !showSalary'));
  assert.ok(!source.includes('view === "salary" && enrichedJornales.length === 0'));
});
