import assert from "node:assert/strict";
import test from "node:test";
import { PORTAL_HOME_URL, PORTAL_LINK_GROUPS } from "../src/portalLinks.js";

test("aparecen los nueve iframes autónomos verificados sin credenciales fijas", () => {
  const links = PORTAL_LINK_GROUPS.flatMap((group) => group.links);
  assert.deepEqual(PORTAL_LINK_GROUPS.map((group) => group.title), ["Consultas", "Solicitudes"]);
  assert.deepEqual(links.map((link) => link.section), [
    "donde-voy", "jornales", "mis-especialidades", "disponibilidad12m", "puertas",
    "chapero", "chapero-especialidades", "jornada-contratada", "dobles"
  ]);
  assert.ok(links.every((link) => !link.url && link.label));
});

test("el acceso principal abre el portal oficial", () => {
  assert.equal(PORTAL_HOME_URL, "https://portal.cpevalencia.com/");
});
