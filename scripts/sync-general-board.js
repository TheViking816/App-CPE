import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";
import { mergeGeneralBoardJourney } from "./general-board-merge.js";

const PORTAL_URL = "https://portal.cpevalencia.com/#User";
let portalUser = String(process.env.CPE_PORTAL_USER || "").trim();
let portalPassword = String(process.env.CPE_PORTAL_PASSWORD || "");
const supabaseUrl = String(process.env.CPE_SUPABASE_URL || "https://wvwdiywtlbffumshbboa.supabase.co").replace(/\/$/, "");
const supabaseSecret = resolveSupabaseAdminKey();
const profileDir = path.resolve(process.env.CPE_GENERAL_BOARD_PROFILE_DIR || path.join("data", "general-board-chrome-profile"));
const generalBoardCdpEndpoint = String(process.env.CPE_GENERAL_BOARD_CDP_ENDPOINT || "").trim();
const browserChannel = String(process.env.CPE_PORTAL_BROWSER_CHANNEL || "chrome").trim();
const headless = String(process.env.CPE_PORTAL_HEADLESS || "false").toLowerCase() !== "false";
const clearanceCookies = (() => {
  try {
    const parsed = JSON.parse(process.env.CPE_PORTAL_CLEARANCE_COOKIES || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
})();

function exactTextPattern(text) {
  return new RegExp(`^\\s*${String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
}

async function findVisibleMatch(page, selector, text, timeout = 0) {
  const deadline = Date.now() + timeout;
  const pattern = exactTextPattern(text);
  do {
    const matches = page.locator(selector).filter({ hasText: pattern });
    const count = await matches.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = matches.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
    if (Date.now() < deadline) await page.waitForTimeout(150);
  } while (Date.now() < deadline);
  return null;
}

function repairPortalText(value) {
  const text = String(value || "").trim();
  if (!/[ÃÂ]/.test(text)) return text;
  try { return Buffer.from(text, "latin1").toString("utf8").trim(); } catch { return text; }
}

function normalizeJourney(value) {
  const match = String(value || "").match(/(\d{2})\s*(?:[/-]|A)\s*(\d{2})/i);
  return match ? `${match[1]}-${match[2]}` : String(value || "").trim();
}

function normalizePart(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim().toUpperCase();
}

function classifyMode(blocks) {
  return blocks.length && blocks.every((block) => normalizePart(block.parte) === "CONTRATACION ANTICIPADA")
    ? "anticipada"
    : "turno";
}

function blockKey(block) {
  return [block.parte, block.empresa, block.buque, block.operacion, block.muelle, block.observaciones]
    .map((value) => String(value || "").trim().toUpperCase()).join("|");
}

function mergeBlocks(previous, current) {
  const blocks = new Map((previous || []).map((block) => [blockKey(block), structuredClone(block)]));
  for (const block of current || []) {
    const key = blockKey(block);
    if (!blocks.has(key)) {
      blocks.set(key, structuredClone(block));
      continue;
    }
    const existing = blocks.get(key);
    const specialties = new Map((existing.especialidades || []).map((item) => [item.nombre, item]));
    for (const specialty of block.especialidades || []) specialties.set(specialty.nombre, specialty);
    existing.especialidades = [...specialties.values()];
  }
  return [...blocks.values()];
}

async function loadSavedPortalCredential() {
  if (portalUser && portalPassword) return;
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/app_cpe_get_general_board_worker_credential`, {
    method: "POST",
    headers: supabaseAdminHeaders(supabaseSecret, { "Content-Type": "application/json" }),
    body: "{}"
  });
  if (!response.ok) throw new Error(`No se pudo recuperar la credencial lectora del tablón: HTTP ${response.status}`);
  const credential = await response.json();
  portalUser = String(credential?.chapa || "").trim();
  portalPassword = String(credential?.portalPassword || "");
  if (!portalUser || !portalPassword) throw new Error("La credencial lectora del tablón está incompleta.");
}

function parseResultTables(tables) {
  const header = tables.find((table) => /NORAY\s*-\s*ASIGNACI/i.test(table.rows?.[0]?.[0] || ""));
  const headerText = repairPortalText(header?.rows?.[1]?.[0] || "");
  const headerMatch = headerText.match(/D[IÍ]A:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*JORNADA DE\s*(\d{2})\s*A\s*(\d{2})/i);
  const blocks = [];
  for (let index = 0; index < tables.length - 1; index += 1) {
    const infoRows = tables[index]?.rows || [];
    const specialtyRows = tables[index + 1]?.rows || [];
    if (!infoRows[0]?.includes("PARTE:") || specialtyRows[0]?.[0] !== "Especialidad") continue;
    const specialties = specialtyRows.slice(1)
      .filter((row) => row[0] && /^\d+$/.test(row[1] || ""))
      .map((row) => ({ nombre: repairPortalText(row[0]), solicitudes: Number(row[1]), ceros: Number(row[2] || 0) }));
    if (!specialties.length) continue;
    blocks.push({
      parte: repairPortalText(infoRows[0][1]),
      buque: repairPortalText(infoRows[0][3]) || "--",
      empresa: repairPortalText(infoRows[1]?.[1]) || "Sin empresa",
      operacion: repairPortalText(infoRows[2]?.[1]) || "Sin operación",
      muelle: repairPortalText(infoRows[3]?.[1]),
      observaciones: repairPortalText(infoRows[4]?.[1]),
      especialidades: specialties
    });
  }
  return {
    fecha: headerMatch?.[1] || "",
    jornada: headerMatch ? `${headerMatch[2]}-${headerMatch[3]}` : "",
    titulo: headerText,
    bloques: blocks
  };
}

async function login(page) {
  if (!portalUser || !portalPassword) throw new Error("Faltan las credenciales lectoras del portal.");
  await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.getByRole("button", { name: "Entendido" }).click({ timeout: 1200 }).catch(() => {});
  const currentUser = page.getByText(new RegExp(`^\\s*${portalUser}\\s*-`)).first();
  if (await currentUser.isVisible().catch(() => false)) return;

  const logout = page.locator("button:visible", { hasText: /Finalizar sesi/i }).first();
  if (await logout.isVisible().catch(() => false)) {
    await logout.click().catch(() => {});
    await page.waitForTimeout(700);
  }

  const visibleInputs = page.locator("input:visible");
  const titledUser = page.locator('input[title="Usuario"]:visible');
  const titledPassword = page.locator('input[title*="Contrase"]:visible');
  const userInput = await titledUser.count() ? titledUser.first() : visibleInputs.nth(0);
  const passwordInput = await titledPassword.count() ? titledPassword.first() : visibleInputs.nth(1);
  await userInput.fill(portalUser, { timeout: 30000 });
  await passwordInput.fill(portalPassword, { timeout: 15000 });
  await page.getByRole("button", { name: /Iniciar sesi/i }).click();
  await Promise.any([
    page.locator("button:visible", { hasText: /Finalizar sesi/i }).first().waitFor({ state: "visible", timeout: 30000 }),
    page.getByText(new RegExp(`^\\s*${portalUser}\\s*-`)).first().waitFor({ state: "visible", timeout: 30000 })
  ]).catch(() => {});
  if (!await page.locator("button:visible", { hasText: /Finalizar sesi/i }).first().isVisible().catch(() => false)) {
    throw new Error("El portal no permitio iniciar sesion para leer el tablon general.");
  }
}

async function openContracting(page) {
  await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  const childSelector = ".NorayMenu .gwt-TreeItem";
  let child = await findVisibleMatch(page, childSelector, "Contratacion Jornada");
  if (!child) child = await findVisibleMatch(page, childSelector, "Contratación Jornada");
  if (!child) {
    const group = await findVisibleMatch(page, ".gwt-TreeItem", "Consultas", 30000);
    if (!group) throw new Error("No se encontro el menu Consultas.");
    await group.click();
    child = await findVisibleMatch(page, childSelector, "Contratación Jornada", 10000)
      || await findVisibleMatch(page, childSelector, "Contratacion Jornada", 10000);
  }
  if (!child) throw new Error("No se encontro Contratacion Jornada.");
  await child.click();
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    for (const frame of page.frames().filter((item) => /SelDatAsig\.asp/i.test(item.url()))) {
      if (await frame.locator('input[type="radio"]:visible').count().catch(() => 0)) return frame;
    }
    await page.waitForTimeout(150);
  }
  throw new Error("No se cargo el selector del tablon general.");
}

async function readTables(frame) {
  await frame.locator("body").waitFor({ state: "visible", timeout: 20000 });
  return frame.locator("table").evaluateAll((tables) => tables.map((table) => ({
    rows: [...table.rows].map((row) => [...row.cells].map((cell) => cell.innerText.trim()))
  })).filter((table) => table.rows.some((row) => row.some(Boolean))));
}

async function collectDate(selectionFrame, targetDate) {
  await selectionFrame.locator('input[type="radio"]:visible').first().waitFor({ state: "visible", timeout: 20000 });
  const selectorUrl = selectionFrame.url();
  const options = await selectionFrame.locator('input[type="radio"]:visible').evaluateAll((radios) => radios.map((input) => ({
    label: input.parentElement?.innerText || input.value || "",
    value: input.value
  })));
  const journeys = [];
  for (const option of options) {
    if (!/SelDatAsig\.asp/i.test(selectionFrame.url())) {
      await selectionFrame.goto(selectorUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    }
    await selectionFrame.locator('input[name="fecha"]:visible').fill(targetDate);
    await selectionFrame.locator(`input[name="Jornada"][value="${option.value}"]:visible`).check();
    const anticipated = selectionFrame.locator('input[name="Anticipada"]:visible');
    if (await anticipated.isChecked().catch(() => false)) await anticipated.click();
    await Promise.all([
      selectionFrame.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
      selectionFrame.locator('input[type="submit"][value="Aceptar"]:visible').click()
    ]);
    await selectionFrame.waitForFunction(() => /NORAY\s*-\s*ASIGNACI|PARTE:|NO\s+HAY\s+DATOS|NO\s+EXISTEN.*ASIGNACI/i
      .test(document.body?.innerText || ""), null, { timeout: 10000 }).catch(() => {});
    const parsed = parseResultTables(await readTables(selectionFrame));
    if (!parsed.jornada) parsed.jornada = normalizeJourney(option.label || option.value);
    if (parsed.bloques.length) {
      parsed.fuentes = [classifyMode(parsed.bloques)];
      const existing = journeys.find((item) => item.fecha === parsed.fecha && item.jornada === parsed.jornada);
      if (existing) {
        existing.fuentes = [...new Set([...existing.fuentes, ...parsed.fuentes])];
        existing.bloques = mergeBlocks(existing.bloques, parsed.bloques);
      } else journeys.push(parsed);
    }
    await selectionFrame.goto(selectorUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  }
  return journeys;
}

function madridDates() {
  const format = (date, locale) => new Intl.DateTimeFormat(locale, {
    timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric"
  }).format(date);
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const noon = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12));
  const tomorrow = new Date(noon.getTime() + 86400000);
  return {
    todayPortal: format(noon, "en-GB"),
    tomorrowPortal: format(tomorrow, "en-GB"),
    todayIso: format(noon, "en-CA")
  };
}

function journeyIsoDate(journey) {
  const match = String(journey?.fecha || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

async function getExistingSnapshot() {
  const response = await fetch(`${supabaseUrl}/rest/v1/app_cpe_general_board_snapshot?select=payload&id=eq.latest&limit=1`, {
    headers: supabaseAdminHeaders(supabaseSecret)
  });
  if (!response.ok) throw new Error(`No se pudo leer el snapshot anterior: HTTP ${response.status}`);
  return (await response.json())?.[0]?.payload || { jornadas: [] };
}

async function publishSnapshot(payload) {
  const response = await fetch(`${supabaseUrl}/rest/v1/app_cpe_general_board_snapshot?on_conflict=id`, {
    method: "POST",
    headers: supabaseAdminHeaders(supabaseSecret, {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    }),
    body: JSON.stringify({ id: "latest", payload, updated_at: payload.generatedAt })
  });
  if (!response.ok) throw new Error(`Supabase rechazo el tablon: HTTP ${response.status} ${await response.text()}`);
}

async function main() {
  if (!supabaseSecret) throw new Error("Falta la clave de Supabase del worker.");
  await loadSavedPortalCredential();
  await fs.mkdir(profileDir, { recursive: true });
  const launchOptions = {
    headless,
    viewport: { width: 1500, height: 1100 },
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    args: ["--disable-blink-features=AutomationControlled"]
  };
  if (browserChannel && browserChannel !== "bundled") launchOptions.channel = browserChannel;
  const browser = generalBoardCdpEndpoint
    ? await chromium.connectOverCDP(generalBoardCdpEndpoint, { timeout: 15000 })
    : null;
  const context = browser
    ? browser.contexts()[0]
    : await chromium.launchPersistentContext(profileDir, launchOptions);
  if (!context) throw new Error("Chrome no ofreció un contexto para leer el tablón general.");
  const page = browser ? await context.newPage() : (context.pages()[0] || await context.newPage());
  try {
    if (clearanceCookies.length) await context.addCookies(clearanceCookies);
    await context.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
    await login(page);
    const frame = await openContracting(page);
    const dates = madridDates();
    const journeys = [
      ...await collectDate(frame, dates.todayPortal),
      ...await collectDate(frame, dates.tomorrowPortal).catch(() => [])
    ];
    if (!journeys.length) throw new Error("El portal no devolvio ninguna jornada del tablon general.");

    const previous = await getExistingSnapshot();
    const merged = new Map((previous.jornadas || [])
      .filter((journey) => journeyIsoDate(journey) >= dates.todayIso)
      .map((journey) => [`${journey.fecha}|${journey.jornada}`, journey]));
    for (const journey of journeys) {
      const key = `${journey.fecha}|${journey.jornada}`;
      const existing = merged.get(key);
      merged.set(key, mergeGeneralBoardJourney(existing, journey, mergeBlocks));
    }
    const snapshot = {
      source: "Portal CPE Valencia - Contratacion Jornada",
      retentionPolicy: "current-and-future-v1",
      retentionDate: dates.todayIso,
      generatedAt: new Date().toISOString(),
      fecha: journeys[0].fecha,
      jornadas: [...merged.values()].sort((a, b) => `${a.fecha}|${a.jornada}`.localeCompare(`${b.fecha}|${b.jornada}`))
    };
    await publishSnapshot(snapshot);
    const total = journeys.reduce((sum, journey) => sum + journey.bloques.reduce((blockSum, block) =>
      blockSum + block.especialidades.reduce((specialtySum, specialty) => specialtySum + specialty.solicitudes, 0), 0), 0);
    console.log(`OK: tablon general publicado (${journeys.length} jornadas, ${total} puestos).`);
  } finally {
    if (browser) await page.close().catch(() => {});
    else await context.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "No se pudo actualizar el tablon general.");
    process.exit(1);
  });
