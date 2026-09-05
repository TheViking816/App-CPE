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

test("la contratacion anticipada se abre desde la tarjeta de portada", () => {
  assert.match(source, /async function readAssignmentDetailViaHomeCard/);
  assert.match(source, /normalizePortalPart\(item\.parte\) === "CA"/);
  assert.match(source, /freshDetail = await readAssignmentDetailViaHomeCard\(page, item\)/);
});

test("los partes derivados de jornales reciben una pagina navegable", () => {
  assert.match(source, /completeAssignmentsFromJournals\(page, asignaciones, jornales\)/);
  assert.doesNotMatch(source, /completeAssignmentsFromJournals\(page\.context\(\), asignaciones, jornales\)/);
});

test("contratacion y vacaciones reconocidas pueden estar vacias sin hacer parcial la lectura", () => {
  const assignmentsMenu = source.match(/async function collectAssignmentsViaMenu[\s\S]*?async function collectAssignmentsViaContractings/)?.[0] || "";
  const vacations = source.match(/async function collectVacacionesViaMenu[\s\S]*?async function enrichAssignmentsWithDetails/)?.[0] || "";
  assert.match(assignmentsMenu, /result\.recognized && Array\.isArray\(result\.rows\)/);
  assert.match(vacations, /result\.recognized && Array\.isArray\(result\.rows\)/);
  assert.match(source, /"vacaciones",[\s\S]*?\{ allowCollectionShrink: true \}/);
});
