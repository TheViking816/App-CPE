import assert from "node:assert/strict";
import test from "node:test";
import { PORTAL_HOME_URL, PORTAL_LINK_GROUPS } from "../src/portalLinks.js";

test("aparecen los nueve iframes autónomos verificados sin credenciales fijas", () => {
  const links = PORTAL_LINK_GROUPS.flatMap((group) => group.links);
  assert.equal(PORTAL_LINK_GROUPS.length, 4);
  assert.deepEqual(links.map((link) => link.section).sort(), [
    "chapero", "chapero-especialidades", "disponibilidad12m", "dobles",
    "donde-voy", "jornada-contratada", "jornales", "mis-especialidades", "puertas"
  ].sort());
  assert.ok(links.every((link) => !link.url && link.label));
});

test("el acceso principal abre el portal oficial", () => {
  assert.equal(PORTAL_HOME_URL, "https://portal.cpevalencia.com/");
});
