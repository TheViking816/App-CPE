import assert from "node:assert/strict";
import test from "node:test";
import { PORTAL_HOME_URL, PORTAL_LINK_GROUPS } from "../src/portalLinks.js";

test("aparecen los accesos Noray personales sin credenciales fijas", () => {
  const links = PORTAL_LINK_GROUPS.flatMap((group) => group.links);
  assert.deepEqual(PORTAL_LINK_GROUPS.map((group) => group.title), ["Consultas", "Solicitudes"]);
  assert.deepEqual(links.map((link) => link.section), [
    "donde-voy", "jornales", "mis-especialidades", "disponibilidad12m", "puertas",
    "chapero", "chapero-especialidades", "jornada-contratada", "puntos-formacion",
    "dobles", "vacaciones", "excluir-jornadas", "situacion-trabajador",
    "solicito-formacion"
  ]);
  assert.deepEqual(PORTAL_LINK_GROUPS[0].links.slice(-1).map((link) => link.label), ["Puntos Formación"]);
  assert.deepEqual(PORTAL_LINK_GROUPS[1].links.slice(-2).map((link) => link.label),
    ["Jornada Flexible 48h", "Solicito Formación"]);
  assert.ok(links.every((link) => !link.url && link.label));
});

test("el acceso principal abre el portal oficial", () => {
  assert.equal(PORTAL_HOME_URL, "https://portal.cpevalencia.com/");
});
