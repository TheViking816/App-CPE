import assert from "node:assert/strict";
import test from "node:test";
import { readPortalSectionWithRetry } from "../scripts/portal-section-retry.js";

test("reintenta una sección en blanco y acepta la segunda lectura", async () => {
  let calls = 0;
  const result = await readPortalSectionWithRetry(async () => {
    calls += 1;
    return calls === 1 ? { recognized: false } : { recognized: true, rows: ["71206"] };
  }, { isAcceptable: (value) => value.recognized });
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.rows, ["71206"]);
});

test("conserva el fallo tras dos lecturas sin datos", async () => {
  const result = await readPortalSectionWithRetry(async () => ({ recognized: false }), {
    isAcceptable: (value) => value.recognized
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 2);
});
