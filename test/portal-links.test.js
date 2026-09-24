import assert from "node:assert/strict";
import test from "node:test";
import { PORTAL_HOME_URL, PORTAL_LINK_GROUPS } from "../src/portalLinks.js";

test("los enlaces del portal están agrupados y no incluyen las antiguas apps externas", () => {
  const links = PORTAL_LINK_GROUPS.flatMap((group) => group.links);
  assert.equal(PORTAL_LINK_GROUPS.length, 4);
  assert.equal(links.length, 13);
  assert.equal(new Set(links.map((link) => link.url)).size, links.length);
  assert.ok(links.every((link) => link.url.startsWith("https://portal.cpevalencia.com/#User,")));
  assert.ok(links.some((link) => link.label === "Solicitar descansos" && link.url.endsWith(",16")));
  assert.ok(links.some((link) => link.label === "Solicitud de vacaciones" && link.url.endsWith(",20")));
});

test("el acceso principal abre el portal oficial", () => {
  assert.equal(PORTAL_HOME_URL, "https://portal.cpevalencia.com/#User");
});
