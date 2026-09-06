import test from "node:test";
import assert from "node:assert/strict";
import { initialIrpfRate, normalizeIrpfRate } from "../src/irpfRate.js";

test("el primer render usa el IRPF del perfil y no muestra el bruto como neto", () => {
  const storage = { getItem: () => "12" };
  assert.equal(initialIrpfRate(25, "72613", storage), 25);
});

test("recupera el IRPF local antes del primer render si el perfil aún no lo trae", () => {
  const storage = { getItem: (key) => key === "app-cpe-irpf-72613" ? "18.5" : null };
  assert.equal(initialIrpfRate(undefined, "72613", storage), 18.5);
});

test("normaliza el porcentaje al intervalo permitido", () => {
  assert.equal(normalizeIrpfRate(-5), 0);
  assert.equal(normalizeIrpfRate(75), 60);
  assert.equal(normalizeIrpfRate(""), null);
});
