import assert from "node:assert/strict";
import test from "node:test";

import { specialties } from "../src/censo.js";

const expected = {
  "pol-trincador": { count: 584, first: "72700", last: "24077" },
  "pol-trinca-coches": { count: 143, first: "72700", last: "24053" }
};

for (const [id, values] of Object.entries(expected)) {
  test(`${id} usa el censo actualizado sin duplicados`, () => {
    const specialty = specialties.find((item) => item.id === id);
    assert.ok(specialty);
    assert.equal(specialty.expectedSize, values.count);
    assert.equal(specialty.censo.length, values.count);
    assert.equal(specialty.censo[0].chapa, values.first);
    assert.equal(specialty.censo.at(-1).chapa, values.last);
    assert.equal(new Set(specialty.censo.map((item) => item.chapa)).size, values.count);
    assert.deepEqual(
      specialty.censo.map((item) => item.position),
      Array.from({ length: values.count }, (_, index) => index + 1)
    );
  });
}

test("normaliza las chapas internas de cuatro cifras de las polivalencias", () => {
  const trincador = specialties.find((item) => item.id === "pol-trincador");
  assert.ok(trincador.censo.some((item) => item.chapa === "24026"));
  assert.ok(trincador.censo.some((item) => item.chapa === "63222"));
  assert.ok(!trincador.censo.some((item) => /^7[34]\d{3}$/.test(item.chapa)));
});
