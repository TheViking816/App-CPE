import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const pdfSource = await readFile(new URL("../src/monthlyPayrollPdf.js", import.meta.url), "utf8");

test("permite añadir horas de relevo dentro de un mes del resumen anual", () => {
  assert.match(appSource, /function PortalMonthDetailModal\(\{[^}]*onToggleRelayHour/);
  assert.match(appSource, /onChange=\{\(event\) => onToggleRelayHour\(item, event\.target\.checked\)\}/);
  assert.match(appSource, /month=\{selectedAnnualMonth\}[\s\S]*onToggleRelayHour=\{toggleRelayHour\}/);
  assert.match(appSource, /Horas relevo/);
});

test("el PDF del mes incluye el total de horas de relevo", () => {
  assert.match(pdfSource, /relay: summary\.relay \+ amount\(item\.payroll\?\.relayHour\)/);
  assert.match(pdfSource, /Relevos: \$\{formatPdfEuro\(totals\.relay\)\}/);
});
