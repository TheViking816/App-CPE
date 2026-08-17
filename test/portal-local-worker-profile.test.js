import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");

test("el worker local reutiliza una sola autorizacion de Cloudflare", () => {
  assert.match(source, /portal-oficial-chrome-profile["',\s]+["']shared/);
});

test("el perfil compartido cierra la sesion anterior antes de cambiar de chapa", () => {
  assert.match(source, /async function logoutExistingPortalSession/);
  assert.match(source, /if \(authenticatedForPortalUser\) return;/);
  assert.match(source, /No se pudo cerrar la sesion anterior del portal de forma segura/);
});
