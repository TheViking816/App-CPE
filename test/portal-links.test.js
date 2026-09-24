import assert from "node:assert/strict";
import test from "node:test";
import { openPortalSectionWindow, PORTAL_HOME_URL, PORTAL_LINK_GROUPS } from "../src/portalLinks.js";

test("los enlaces del portal están agrupados y no incluyen las antiguas apps externas", () => {
  const links = PORTAL_LINK_GROUPS.flatMap((group) => group.links);
  assert.equal(PORTAL_LINK_GROUPS.length, 4);
  assert.equal(links.length, 13);
  assert.equal(new Set(links.map((link) => link.url)).size, links.length);
  assert.ok(links.every((link) => link.url.startsWith("https://portal.cpevalencia.com/#User,")));
  assert.ok(links.some((link) => link.label === "Solicitar descansos" && link.url.endsWith(",16")));
  assert.ok(links.some((link) => link.label === "Solicitud de vacaciones" && link.url.endsWith(",20")));
});

test("inicializa el portal antes de abrir una sección en la misma pestaña", () => {
  const calls = [];
  const popup = { opener: {}, closed: false, location: { href: PORTAL_HOME_URL } };
  const browser = {
    open: (url, target) => { calls.push(["open", url, target]); return popup; },
    setTimeout: (callback, delay) => { calls.push(["delay", delay]); callback(); }
  };
  const target = "https://portal.cpevalencia.com/#User,ViewNoray,16";
  assert.equal(openPortalSectionWindow(target, browser), true);
  assert.deepEqual(calls, [["open", PORTAL_HOME_URL, "portal-cpe"], ["delay", 1500]]);
  assert.equal(popup.opener, null);
  assert.equal(popup.location.href, target);
});

test("mantiene el enlace nativo si el navegador bloquea la pestaña", () => {
  assert.equal(openPortalSectionWindow(PORTAL_HOME_URL, { open: () => null }), false);
});
