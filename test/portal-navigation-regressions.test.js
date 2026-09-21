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
  assert.match(navigation, /openMenu\(page, "Consultas", "Jornales y Primas"\)/);
  assert.doesNotMatch(navigation, /openPortalHash\(page, "User,ViewNoray,2"\)/);
  assert.match(navigation, /page\.reload\(\{ waitUntil: "domcontentloaded", timeout: 45000 \}\)/);
  assert.match(navigation, /permanecio en blanco tras repetir el clic y recargar el portal/);
  assert.match(navigation, /title\*="productividad"/);
  assert.match(navigation, /aria-label\*="productividad"/);
  assert.match(navigation, /Para ver las primas, pulsa el ojo/);
  assert.match(navigation, /Validar\|Verificar/);
  assert.match(navigation, /security-pass/);
  assert.match(navigation, /Do not treat that intermediate state as ready/);
  assert.match(section, /premiumRevealControl/);
  assert.match(section, /Abriendo la productividad de Jornales y Primas/);
  assert.match(navigation, /data-lucide="eye"/);
  assert.doesNotMatch(section, /openMenu\(page, "Consultas", "Consulta de Primas Productividad"\)/);
  assert.doesNotMatch(section, /openPortalHash\(page, "User,ViewNoray,10"\)/);
});

test("primas escribe y verifica la clave en el formulario de productividad", () => {
  const section = source.match(/async function findPremiumSecurityInput\([\s\S]*?async function collectPrimas\(/)?.[0] || "";
  assert.match(section, /ancestor::form/);
  assert.match(section, /input\[type="password"\]/);
  assert.match(section, /input\[placeholder\*="clave" i\]/);
  assert.match(section, /writtenValue !== portalSecurityKey/);
  assert.match(section, /No se pudo escribir la clave de seguridad/);
  assert.match(source, /El portal no habilito la verificacion de la clave/);
  assert.match(source, /unlockedStableSince/);
  assert.match(source, /Date\.now\(\) - unlockedStableSince >= PORTAL_PREMIUM_STABLE_MS/);
  assert.match(source, /PORTAL_PREMIUM_STABLE_MS = 1200/);
  assert.match(source, /quedo en blanco tras verificar; se vuelve a abrir la seccion/);
  assert.match(source, /retrySecurityControl/);
});

test("el login no confunde otros campos de texto con el usuario", () => {
  const section = source.match(/async function login\([\s\S]*?async function openMenu/)?.[0] || "";
  assert.match(section, /input\[title="Usuario"\]:visible/);
  assert.doesNotMatch(section, /input\[type="text"\]:visible/);
});

test("Bolsa de Excepciones usa primero el menú y conserva ViewNoray 17 como respaldo", () => {
  const section = source.match(/async function collectExceptions[\s\S]*?async function getStoredPayrollDocumentIds/)?.[0] || "";
  assert.match(section, /openPortalHash\(page, "User,ViewNoray,17"\)/);
  assert.match(section, /openMenu\(page, "Solicitudes", "Bolsa de Excepciones"\)/);
  assert.ok(section.indexOf('openMenu(page, "Solicitudes", "Bolsa de Excepciones")') < section.indexOf('openPortalHash(page, "User,ViewNoray,17")'));
});

test("la actualización rápida reutiliza Jornales y Primas y omite especialidades guardadas", () => {
  assert.match(source, /useCombinedCurrentScreen = fastMode && hasJournalData/);
  assert.match(source, /collectCurrentJornalesFromCombined/);
  assert.match(source, /fastMode && hasSavedSpecialties/);
  assert.match(source, /se omite ViewNoray 3 en la actualizacion rapida/);
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
