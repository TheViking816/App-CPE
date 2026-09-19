import { chromium } from "playwright";
import { censusTargets, chooseCensusReaders, parseCensusCards } from "./census-cards.js";
import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const baseUrl = String(process.env.CPE_SUPABASE_URL || "https://wvwdiywtlbffumshbboa.supabase.co").replace(/\/$/, "");
const key = resolveSupabaseAdminKey();
const cdp = String(process.env.CPE_PORTAL_CDP_ENDPOINT || "").trim();
const portalUrl = "https://portal.cpevalencia.com/#User";
const adminHeaders = supabaseAdminHeaders(key);

async function supabaseRequest(path, init = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...adminHeaders, ...(init.headers || {}) }
  });
  if (!response.ok) throw new Error(`Supabase ${response.status} (${path.split("?")[0]}): ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function loadReaders() {
  const [users, configs] = await Promise.all([
    supabaseRequest("app_cpe_users?select=chapa,specialties&limit=10000"),
    supabaseRequest("app_cpe_portal_auto_sync?select=chapa,enabled&enabled=eq.true&limit=10000")
  ]);
  const configured = new Set(configs.map((row) => row.chapa));
  return chooseCensusReaders(users.map((row) => ({
    chapa: row.chapa,
    specialties: Array.isArray(row.specialties) ? row.specialties : [],
    enabled: configured.has(row.chapa)
  })), censusTargets.map((target) => target.id));
}

async function credentialFor(chapa) {
  const result = await supabaseRequest("rpc/app_cpe_get_census_worker_credential", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_chapa: chapa })
  });
  if (result?.chapa !== chapa || !result?.portalPassword) throw new Error(`Credencial incompleta para ${chapa}.`);
  return result.portalPassword;
}

async function visibleAcrossFrames(page, selector) {
  for (const frame of page.frames()) {
    const locator = frame.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

async function visibleLoginButton(page) {
  for (const frame of page.frames()) {
    const button = frame.getByRole("button", { name: /Iniciar sesi/i }).first();
    if (await button.isVisible().catch(() => false)) return button;
  }
  return null;
}

async function pageState(page) {
  const text = (await Promise.all(page.frames().map((frame) => frame.locator("body").innerText().catch(() => "")))).join(" ");
  if (/Verificaci[oó]n de seguridad|verifique que es un ser humano|Cloudflare Ray ID/i.test(text)) return "challenge";
  if (/usuario|consultas/i.test(text) && await visibleAcrossFrames(page, ".gwt-TreeItem")) return "authenticated";
  if (await visibleAcrossFrames(page, 'input[title="Usuario"], input[type="password"]')) return "login";
  return "pending";
}

async function waitState(page, expected, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await pageState(page);
    if (expected.includes(state)) return state;
    await page.waitForTimeout(300);
  }
  return pageState(page);
}

async function login(page, chapa, password) {
  await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.getByRole("button", { name: "Entendido" }).click({ timeout: 1000 }).catch(() => {});
  const state = await waitState(page, ["login", "challenge", "authenticated"], 25000);
  if (state === "challenge") throw new Error("Cloudflare pide comprobación humana; cierra el gateway y vuelve a ejecutar más tarde.");
  if (state !== "login") throw new Error(`No apareció un acceso limpio para ${chapa} (${state}).`);
  const userInput = await visibleAcrossFrames(page, 'input[title="Usuario"]:visible, input[type="text"]:visible');
  const passwordInput = await visibleAcrossFrames(page, 'input[title*="Contrase"]:visible, input[type="password"]:visible');
  const loginButton = await visibleLoginButton(page);
  if (!userInput || !passwordInput || !loginButton) throw new Error(`Formulario de acceso incompleto para ${chapa}.`);
  await userInput.fill(chapa);
  await passwordInput.fill(password);
  await loginButton.click();
  const after = await waitState(page, ["authenticated", "challenge"], 35000);
  if (after !== "authenticated") throw new Error(`El portal no confirmó el acceso de ${chapa} (${after}).`);
}

async function findMenu(page, label) {
  for (const frame of page.frames()) {
    const items = frame.locator(".gwt-TreeItem").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`, "i") });
    for (let i = 0; i < await items.count().catch(() => 0); i += 1) {
      if (await items.nth(i).isVisible().catch(() => false)) return items.nth(i);
    }
  }
  return null;
}

async function readCards(page, expectedIds) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let item = await findMenu(page, "Chapero por especialidades");
    if (!item) {
      const group = await findMenu(page, "Consultas");
      if (group) await group.click();
      item = await findMenu(page, "Chapero por especialidades");
    }
    if (!item) throw new Error("No se encontró el menú Chapero por especialidades.");
    await item.click();
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        const submit = frame.locator('form[action*="InformeEspecialidadesChapSinE"] input[type="submit"]').first();
        if (await submit.isVisible().catch(() => false)) await submit.click().catch(() => {});
        const body = await frame.locator("body").innerText().catch(() => "");
        const parsed = parseCensusCards(body);
        const found = new Set(parsed.cards.map((card) => card.id));
        if (parsed.headings > 0 && parsed.invalid.length === 0
          && expectedIds.every((id) => found.has(id))) return parsed.cards;
      }
      if (await pageState(page) === "challenge") throw new Error("Cloudflare ha interrumpido la lectura.");
      await page.waitForTimeout(400);
    }
    if (attempt < 3) await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  }
  throw new Error("El chapero por especialidades quedó vacío o incompleto tras tres intentos.");
}

async function saveCard(card) {
  await supabaseRequest("app_cpe_door_snapshots?on_conflict=specialty", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      specialty: `CENSO:${card.id}`,
      source: `Chapero por especialidades (${card.portalType})`,
      doors: [],
      raw_columns: { id: card.id, kind: card.kind, expectedSize: card.expectedSize, censo: card.censo },
      updated_at: new Date().toISOString()
    })
  });
}

async function main() {
  const readers = await loadReaders();
  if (!readers.length) throw new Error("No hay cuentas activas con claves guardadas para leer los censos.");
  // Preflight before opening Chrome: absence of the dedicated RPC must never
  // enqueue ordinary portal jobs or silently fall back to another credential.
  await credentialFor(readers[0].chapa);
  if (process.argv.includes("--preflight")) {
    console.log(`Acceso a censos preparado; ${readers.length} cuentas activas disponibles.`);
    return;
  }
  if (!cdp) throw new Error("Falta CPE_PORTAL_CDP_ENDPOINT; abre el gateway antes de iniciar el lector de censos.");
  const browser = await chromium.connectOverCDP(cdp, { timeout: 15000 });
  const gateway = browser.contexts()[0];
  const cookies = await gateway.cookies("https://portal.cpevalencia.com");
  const clearance = cookies.filter((cookie) => cookie.name === "cf_clearance" || cookie.name.startsWith("cf_chl_"));
  const missing = new Set(censusTargets.map((target) => target.id));
  const saved = [];
  const errors = [];
  try {
    for (const reader of readers) {
      if (!missing.size) break;
      let context;
      try {
        const password = await credentialFor(reader.chapa);
        context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, locale: "es-ES" });
        if (clearance.length) await context.addCookies(clearance);
        const page = await context.newPage();
        await login(page, reader.chapa, password);
        const expectedIds = reader.specialties.filter((id) => missing.has(id));
        const cards = await readCards(page, expectedIds);
        for (const card of cards) {
          if (!missing.has(card.id)) continue;
          await saveCard(card);
          missing.delete(card.id);
          saved.push(`${card.portalType} ${card.portalName} (${card.expectedSize})`);
        }
        console.log(`${reader.chapa}: ${cards.length} bloques válidos; faltan ${missing.size} censos.`);
      } catch (error) {
        errors.push(`${reader.chapa}: ${error instanceof Error ? error.message : error}`);
        console.error(errors.at(-1));
        if (/Cloudflare/i.test(String(error))) break;
      } finally {
        await context?.close().catch(() => {});
      }
    }
  } finally {
    browser._connection.close();
  }
  console.log(`Censos actualizados: ${saved.length}/${censusTargets.length}. ${saved.join(", ")}`);
  if (missing.size) {
    console.error(`Sin actualizar: ${[...missing].join(", ")}. Se conservan los censos anteriores.`);
    process.exitCode = 1;
  }
  if (errors.length) console.error(`Usuarios con incidencia: ${errors.length}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
