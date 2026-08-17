import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const supabaseClientSource = await readFile(new URL("../src/supabaseClient.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("la clave de seguridad abre un teclado alfanumerico", () => {
  const fieldStart = appSource.indexOf('aria-label="Clave de seguridad opcional"');
  assert.notEqual(fieldStart, -1);

  const fieldMarkup = appSource.slice(Math.max(0, fieldStart - 300), fieldStart + 300);
  assert.match(fieldMarkup, /inputMode="text"/);
  assert.match(fieldMarkup, /autoCapitalize="none"/);
  assert.doesNotMatch(fieldMarkup, /inputMode="numeric"/);
});

test("la navegacion movil respeta las zonas seguras y no es translucida", () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(styles, /padding-bottom: env\(safe-area-inset-bottom\)/);
  assert.match(styles, /min-height: calc\(68px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(styles, /\.bottom-nav[\s\S]*?background: #fff;/);
  assert.doesNotMatch(styles, /\.bottom-nav[\s\S]{0,500}?background: rgba\(255, 255, 255/);
});

test("no muestra un falso aviso de lectura parcial cuando ya hay datos", () => {
  assert.doesNotMatch(appSource, /Lectura parcial del portal/);
  assert.doesNotMatch(appSource, /Algunas consultas no respondieron/);
});

test("registra la página activa de cada visita con la sesión del usuario", () => {
  assert.match(appSource, /trackPageVisit\(\{ token: session\.token, page: activeTab \}\)/);
  assert.match(supabaseClientSource, /app_cpe_track_page_visit/);
  assert.match(supabaseClientSource, /p_page: page/);
});

test("muestra el acceso para conectar el portal según las claves y no según los datos previos", () => {
  assert.match(appSource, /portalConnected === false && <PortalConnectCallout/);
  assert.doesNotMatch(appSource, /!hasPortalData && <PortalConnectCallout/);
  assert.match(appSource, /getPortalAutoSyncStatus\(\{ token: session\.token \}\)/);
});

test("reutiliza el portal cargado y abre cada pantalla desde arriba", () => {
  assert.match(appSource, /initialSnapshot=\{portalSnapshot\}/);
  assert.match(appSource, /const \[loading, setLoading\] = useState\(!initialSnapshot\)/);
  assert.match(appSource, /useLayoutEffect\(\(\) => \{[\s\S]*?window\.scrollTo\(\{ top: 0/);
});

test("las excepciones son legibles y no tienen scroll interior en móvil", () => {
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.portal-exceptions-summary strong \{ font-size: 23px; \}/);
  assert.match(styles, /\.portal-exceptions-list \{ max-height: none; padding: 0 12px; overflow: visible; \}/);
});
