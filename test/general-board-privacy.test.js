import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const source = await fs.readFile(new URL("../src/GeneralBoard.jsx", import.meta.url), "utf8");

test("el Tablón general publica chapas pero nunca nombres de trabajadores", () => {
  assert.match(source, /formatBolsaChapa\(item\.chapa\) \|\| "S\/N"/);
  assert.doesNotMatch(source, /item\.name \? ` · \$\{item\.name\}`/);
  assert.doesNotMatch(source, /worker\.chapa, worker\.name/);
});
