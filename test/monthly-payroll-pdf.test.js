import test from "node:test";
import assert from "node:assert/strict";

import { createMonthlyPayrollPdf } from "../src/monthlyPayrollPdf.js";

test("genera un PDF mensual con resumen y todos los jornales", () => {
  const enriched = Array.from({ length: 40 }, (_, index) => ({
    dia: String(index + 1),
    especialidad: "CONDUCTOR 1a",
    empresa: "CSP IBERIAN VALENCIA TERMINAL",
    payroll: {
      shift: "08-14",
      base: 105.53,
      complement: 7.38,
      prima: 20,
      total: 132.91,
      operationType: "ESTIBA"
    }
  }));

  const document = createMonthlyPayrollPdf({ monthLabel: "Agosto de 2026", enriched }, 39);
  const bytes = document.output("arraybuffer");

  assert.ok(bytes.byteLength > 5_000);
  assert.ok(document.getNumberOfPages() >= 2);
});
