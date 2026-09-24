import assert from "node:assert/strict";
import test from "node:test";
import { NORAY_PILOT_CHAPA, PORTAL_HOME_URL, PORTAL_LINK_GROUPS } from "../src/portalLinks.js";

test("solo aparecen los seis iframes autónomos verificados", () => {
  const links = PORTAL_LINK_GROUPS.flatMap((group) => group.links);
  assert.equal(NORAY_PILOT_CHAPA, "72683");
  assert.equal(PORTAL_LINK_GROUPS.length, 2);
  assert.deepEqual(links.map((link) => link.section).sort(), [
    "chapero", "chapero-especialidades", "donde-voy", "jornada-contratada",
    "jornales", "mis-especialidades"
  ].sort());
  assert.ok(links.every((link) => !link.url && link.label));
});

test("el acceso principal abre el portal oficial", () => {
  assert.equal(PORTAL_HOME_URL, "https://portal.cpevalencia.com/#User");
});
