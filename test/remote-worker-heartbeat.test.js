import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../scripts/remote-pending-worker-agent.js", import.meta.url), "utf8");
test("el agente mantiene el latido durante trabajos largos sin solapar peticiones", () => {
  assert.match(source, /const heartbeatTimer = setInterval/);
  assert.match(source, /if \(!running \|\| stopping \|\| heartbeatPending\) return/);
  assert.match(source, /finally \{ heartbeatPending = false; \}/);
});
test("un fallo libera el bloqueo local y las llamadas de red tienen limite", () => {
  assert.match(source, /finally \{\s*running = false;/);
  assert.match(source, /signal: AbortSignal.timeout\(20_000\)/);
  assert.doesNotMatch(source, /await heartbeat\("idle", "PC preparado para órdenes remotas"\)/);
});
