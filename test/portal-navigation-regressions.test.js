import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");

test("descansos abre primero la pagina directa y no depende del iframe GWT", () => {
  const section = source.match(/async function collectDescansos[\s\S]*?async function collectSl/)?.[0] || "";
  assert.match(section, /\/Noray\/Prueba\.asp/);
  assert.match(section, /searchParams\.set\("f", "1"\)/);
  assert.match(section, /searchParams\.set\("mode", "GWT"\)/);
  assert.ok(section.indexOf("directPage.goto") < section.indexOf("openMenu(page"));
  assert.match(section, /openMenu\(page, "Solicitudes", "Solicitar Descansos"\)/);
  assert.match(section, /waitForParsedContext\(\s*page\.context\(\)/);
  assert.doesNotMatch(section, /openMenu\(page, "Solicitudes", "Solicitar Descansos", \/Prueba/);
});

test("Consulta SL abre primero MostrarSL directo y conserva el menú como respaldo", () => {
  const section = source.match(/async function collectSl[\s\S]*?async function collectUserSpecialties/)?.[0] || "";
  assert.match(section, /\/Noray\/MostrarSL\.asp/);
  assert.ok(section.indexOf("directPage.goto") < section.indexOf("openMenu(page"));
  assert.match(section, /openMenu\(page, "Consultas", "Consulta posicion SL", \/MostrarSL/);
  assert.match(section, /markAuthoritativeSl/);
});

test("primas usa Jornales y Primas y deja de abrir la ruta retirada", () => {
  const navigation = source.match(/function premiumRevealLocator\([\s\S]*?async function collectPrimas\(/)?.[0] || "";
  const section = source.match(/async function collectPrimas\([\s\S]*?async function collectPrimasHistory/)?.[0] || "";
  assert.match(section, /openJornalesPrimas\(page\)/);
  assert.match(navigation, /openPortalHash\(page, "User,ViewNoray,2"\)/);
  assert.match(navigation, /openMenu\(page, "Consultas", "Jornales y Primas"\)/);
  assert.match(navigation, /page\.reload\(\{ waitUntil: "domcontentloaded", timeout: 45000 \}\)/);
  assert.match(navigation, /permanecio en blanco tras repetir el clic y recargar el portal/);
  assert.match(section, /premiumRevealControl/);
  assert.match(navigation, /data-lucide="eye"/);
  assert.doesNotMatch(section, /openMenu\(page, "Consultas", "Consulta de Primas Productividad"\)/);
  assert.doesNotMatch(section, /openPortalHash\(page, "User,ViewNoray,10"\)/);
});

test("Bolsa de Excepciones conserva ViewNoray 17 sin esperar en un panel vacío", () => {
  const section = source.match(/async function collectExceptions[\s\S]*?async function getStoredPayrollDocumentIds/)?.[0] || "";
  assert.match(section, /openPortalHash\(page, "User,ViewNoray,17"\)/);
  assert.match(section, /readCurrentScreen\(2500\)/);
  assert.match(section, /openMenu\(page, "Solicitudes", "Bolsa de Excepciones"\)/);
});

test("la contratacion anticipada se abre desde el enlace de Donde voy", () => {
  const section = source.match(/async function readAnticipatedAssignmentDetailViaMenu[\s\S]*?async function readPortalAuthState/)?.[0] || "";
  assert.match(section, /openMenu\(sourcePage, "Consultas", "¿Dónde voy\? - Orden Servicio"\)/);
  assert.match(section, /expandWhereAmIAssignment\(listFrame, assignment\)/);
  assert.match(section, /getByText\(\/\^\\s\*ANTICIPADA\\s\*\$\/i\)/);
  assert.match(section, /closest\("a, button, \[role=button\], \[onclick\]"\)/);
  assert.match(source, /normalizePortalPart\(item\.parte\) === "CA"/);
  assert.match(source, /freshDetail = await readAnticipatedAssignmentDetailViaMenu\(page, item\)/);
});

test("los partes derivados de jornales reciben una pagina navegable", () => {
  assert.match(source, /completeAssignmentsFromJournals\(page, asignaciones, jornales\)/);
  assert.doesNotMatch(source, /completeAssignmentsFromJournals\(page\.context\(\), asignaciones, jornales\)/);
});

test("el enlace del parte nuevo admite el sufijo visual de buque pendiente", () => {
  assert.match(source, /text\.replace\(\/\\s\+--\.\*\$\/, ""\)\.trim\(\)/);
});

test("abre primero el acordeon exacto de fecha y jornada antes de pulsar el parte", () => {
  assert.match(source, /async function expandWhereAmIAssignment/);
  assert.match(source, /await expandWhereAmIAssignment\(listFrame, assignment\)/);
  assert.match(source, /shortDate/);
  assert.match(source, /compactShift/);
});

test("contratacion y vacaciones reconocidas pueden estar vacias sin hacer parcial la lectura", () => {
  const assignmentsMenu = source.match(/async function collectAssignmentsViaMenu[\s\S]*?async function collectAssignmentsViaContractings/)?.[0] || "";
  const vacations = source.match(/async function collectVacacionesViaMenu[\s\S]*?async function enrichAssignmentsWithDetails/)?.[0] || "";
  assert.match(assignmentsMenu, /result\.recognized && Array\.isArray\(result\.rows\)/);
  assert.match(vacations, /result\.recognized && Array\.isArray\(result\.rows\)/);
  assert.match(source, /"vacaciones",[\s\S]*?\{ allowCollectionShrink: true \}/);
});
