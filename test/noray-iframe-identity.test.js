import assert from "node:assert/strict";
import test from "node:test";
import { norayRegistroFromUrl } from "../scripts/noray-iframe-identity.js";

test("solo lee el registro del iframe autenticado del propio usuario", () => {
  const url = `https://norayweb.cpevalencia.com/puertas?req=login&usr=72710&rec=4321&pwd=${"a".repeat(64)}`;
  assert.equal(norayRegistroFromUrl(url, "72710"), 4321);
  assert.equal(norayRegistroFromUrl(url, "72683"), null);
  assert.equal(norayRegistroFromUrl(url.replace("norayweb.cpevalencia.com", "example.com"), "72710"), null);
  assert.equal(norayRegistroFromUrl(url.replace("rec=4321", "rec=0"), "72710"), null);
  assert.equal(norayRegistroFromUrl(url.replace(`pwd=${"a".repeat(64)}`, "pwd=incorrecta"), "72710"), null);
});
