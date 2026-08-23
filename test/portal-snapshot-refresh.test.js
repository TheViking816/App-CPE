import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const serviceWorkerSource = await readFile(new URL("../public/service-worker.js", import.meta.url), "utf8");

test("revalida el snapshot del portal mientras el usuario mantiene abierta la aplicacion", () => {
  assert.match(appSource, /window\.setInterval\(refreshSnapshot, SNAPSHOT_POLL_MS\)/);
  assert.match(appSource, /window\.addEventListener\("focus", refreshSnapshot\)/);
  assert.match(appSource, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.match(appSource, /await loadSnapshot\(\{ silent: true \}\)/);
});

test("fuerza a las instalaciones existentes a recibir la version corregida", () => {
  assert.match(mainSource, /service-worker\.js\?v=20260822-paid-premium-history-1/);
  assert.match(serviceWorkerSource, /20260822-paid-premium-history-1/);
});
