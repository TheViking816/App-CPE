import test from "node:test";
import assert from "node:assert/strict";
import { orderPayrollDocuments } from "../src/payrollDocumentOrder.js";

test("ordena las nominas por periodo descendente y agrupa mensual y anticipo", () => {
  const rows = [
    { id: "feb-advance", type: "Anticipo 1-15", period: "02/26" },
    { id: "aug-extra", type: "Paga extra", period: "08/26" },
    { id: "jul-monthly", type: "Mensual", period: "07/26" },
    { id: "aug-advance", type: "Anticipo 1-15", period: "08/26" },
    { id: "jul-review", type: "Revisión salarial", period: "07/26" },
    { id: "aug-monthly", type: "Mensual", period: "08/26" },
    { id: "jul-advance", type: "Anticipo 1-15", period: "07/26" },
    { id: "feb-monthly", type: "Mensual", period: "02/26" }
  ];

  assert.deepEqual(orderPayrollDocuments(rows).map(({ id }) => id), [
    "aug-monthly",
    "aug-advance",
    "aug-extra",
    "jul-monthly",
    "jul-advance",
    "jul-review",
    "feb-monthly",
    "feb-advance"
  ]);
});

test("respeta el ano y no modifica el array original", () => {
  const rows = [
    { id: "dec", type: "Mensual", period: "12/25" },
    { id: "jan", type: "Mensual", period: "01/26" }
  ];

  assert.deepEqual(orderPayrollDocuments(rows).map(({ id }) => id), ["jan", "dec"]);
  assert.deepEqual(rows.map(({ id }) => id), ["dec", "jan"]);
});
