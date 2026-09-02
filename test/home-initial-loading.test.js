import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("Inicio espera la primera carga coordinada antes de mostrar datos", () => {
  assert.match(app, /doorConfigLoadedFor !== activeSpecialty\.id/);
  assert.match(app, /portalSnapshotLoadedFor !== session\.token/);
  assert.match(app, /portalConnectionLoadedFor !== session\.token/);
  assert.match(app, /homeInitialLoading\s*\? <HomeInitialLoading \/>/);
});

test("la espera inicial muestra un estado limpio y accesible", () => {
  assert.match(app, /aria-busy="true"/);
  assert.match(app, /Cargando tu inicio/);
  assert.match(styles, /\.home-initial-loading/);
  assert.match(styles, /@keyframes home-loading-shimmer/);
});
