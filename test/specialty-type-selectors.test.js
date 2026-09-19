import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

test("los selectores agrupan y etiquetan TU y TP", () => {
  assert.match(source, /Especialidades de turno \(TU\)/);
  assert.match(source, /Polivalencias \(TP\)/);
  assert.match(source, /<optgroup key=\{kind\} label=\{group\}>/);
  assert.ok((source.match(/<SpecialtySelectOptions items=\{availableSpecialties\} \/>/g) || []).length >= 4);
});

test("Inicio y Puertas explican cuando no hay posición en el censo", () => {
  assert.match(source, /function MissingCensusPosition/);
  assert.match(source, /no figura en el censo guardado/);
  assert.ok((source.match(/<MissingCensusPosition /g) || []).length >= 4);
});
