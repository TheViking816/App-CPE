import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const guardSource = await readFile(new URL("../scripts/verify-production-bundle.js", import.meta.url), "utf8");

test("ningún despliegue puede omitir paid ni el histórico mensual de primas", () => {
  assert.match(packageJson.scripts.build, /verify-production-bundle\.js/);
  assert.match(guardSource, /produccionEstado === \"paid\"/);
  assert.match(guardSource, /premiumRowsForMonth\(premiumHistory, month\)/);
  assert.match(guardSource, /bundle final no contiene el estado paid/);
});
