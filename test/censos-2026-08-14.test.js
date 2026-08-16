import assert from "node:assert/strict";
import test from "node:test";

import { specialties } from "../src/censo.js";

const expected = {
  "conductor-1a": { count: 568, first: "72699", last: "71812" },
  "conductor-2a": { count: 479, first: "72699", last: "72744" },
  "pol-especialista": { count: 1308, first: "72699", last: "72744" }
};

for (const [id, values] of Object.entries(expected)) {
  test(`${id} conserva el orden y las posiciones del censo actualizado`, () => {
    const specialty = specialties.find((item) => item.id === id);
    assert.ok(specialty, `No existe la especialidad ${id}`);
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

test("conductor-1a incluye las nuevas chapas en su posicion correcta", () => {
  const specialty = specialties.find((item) => item.id === "conductor-1a");
  assert.equal(specialty.censo[9].chapa, "72717");
  assert.equal(specialty.censo[198].chapa, "71763");
});
