import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const privateDataDir = path.join(rootDir, "data", "portal-oficial");
const defaultProjectRef = "wvwdiywtlbffumshbboa";
const PORTAL_URL = "https://portal.cpevalencia.com/#User";
const STATUS_PATH = path.join(privateDataDir, "portal-sync-status.json");

const portalUser = normalizeChapa(process.env.CPE_PORTAL_USER || process.env.CPE_USER);
const portalPassword = String(process.env.CPE_PORTAL_PASSWORD || process.env.CPE_PASSWORD || "");
const portalSecurityKey = String(process.env.CPE_PORTAL_SECURITY_KEY || "");
const supabaseUrl = process.env.CPE_SUPABASE_URL;
const supabaseServiceRole = process.env.CPE_SUPABASE_SERVICE_ROLE;
const headless = String(process.env.CPE_PORTAL_HEADLESS || "false").toLowerCase() !== "false";
const profileDir = path.resolve(process.env.CPE_PORTAL_PROFILE_DIR || "data/portal-oficial-chrome-profile");
const browserChannel = String(process.env.CPE_PORTAL_BROWSER_CHANNEL || "bundled").trim();

function resolveSupabaseUrl(value) {
  const firstLine = String(value || "")
    .replace(/\\r|\\n/g, "")
    .trim()
    .split(/\s+/)[0] || defaultProjectRef;

  if (/^https?:\/\//i.test(firstLine)) {
    try {
      return new URL(firstLine).origin;
    } catch {
      return `https://${defaultProjectRef}.supabase.co`;
    }
  }

  if (/^[a-z0-9]{20}$/i.test(firstLine)) return `https://${firstLine}.supabase.co`;
  return `https://${defaultProjectRef}.supabase.co`;
}

function normalizeChapa(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 5) return digits.slice(-5);
  return `7${digits.padStart(4, "0")}`;
}

function cleanText(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function textFromHtml(html = "") {
  return cleanText(String(html)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " "));
}

function parseRowsFromTable(html = "") {
  const rows = [];
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((match) => textFromHtml(match[1]).replace(/\|/g, " ").trim())
      .filter(Boolean);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function parseJornales(html = "") {
  const rows = parseRowsFromTable(html);
  const headerIndex = rows.findIndex((row) => (
    row.some((cell) => /jornal/i.test(cell))
    && row.some((cell) => /especialidad/i.test(cell))
  ));
  const pageText = textFromHtml(html);
  const monthLabel = pageText.match(/Jornales\s+de\s+([^\n|]+)/i)?.[1]?.trim() || "";

  if (headerIndex === -1) return { monthLabel, rows: [] };

  const headers = rows[headerIndex].map((item) => item.toLowerCase());
  const indexOf = (pattern, fallback) => {
    const index = headers.findIndex((item) => pattern.test(item));
    return index === -1 ? fallback : index;
  };

  return {
    monthLabel,
    rows: rows.slice(headerIndex + 1)
      .filter((row) => row.length >= 6 && /^\d+$/.test(String(row[0] || "")))
      .map((row) => ({
        jornal: row[indexOf(/jornal/, 0)] || "",
        parte: row[indexOf(/parte/, 1)] || "",
        dia: row[indexOf(/^dia$/, 2)] || "",
        tipo: row[indexOf(/tipo/, 3)] || "",
        jornada: row[indexOf(/jornada/, 4)] || "",
        especialidad: row[indexOf(/especialidad/, 5)] || "",
        empresa: row[indexOf(/empresa/, 6)] || "",
        buque: row[indexOf(/buque/, 7)] || "",
        operacion: row[indexOf(/operaci/, 8)] || "",
        produccion: row[indexOf(/producci/, 9)] || ""
      }))
  };
}

function parseSl(html = "") {
  const rows = parseRowsFromTable(html);
  const headerIndex = rows.findIndex((row) => (
    row.some((cell) => /fecha/i.test(cell)) && row.some((cell) => /posicion/i.test(cell))
  ));

  if (headerIndex === -1) return { rows: [] };

  return {
    rows: rows.slice(headerIndex + 1)
      .filter((row) => /^\d{2}\/\d{2}\/\d{4}$/.test(row[0] || ""))
      .map((row) => ({ fecha: row[0], posicion: row[1] || "" }))
  };
}

function parseDescansos(html = "") {
  const pageText = textFromHtml(html);
  const worker = {
    chapa: normalizeChapa(pageText.match(/\b7\d{4}\b/)?.[0] || ""),
    name: pageText.match(/\b7\d{4}\b\s+([A-Z ]{6,})/i)?.[1]?.trim() || "",
    group: pageText.match(/Grupo\s+de\s+Descanso\s+\d{4}:\s*([^\n|]+)/i)?.[1]?.trim() || "",
    currentMonthRest: Number(pageText.match(/Descansos\s+mes\s+actual:\s*\((\d+)\)/i)?.[1] || 0),
    nextMonthRest: Number(pageText.match(/Descansos\s+proximo\s+mes:\s*\((\d+)\)/i)?.[1] || 0)
  };

  const monthsByKey = new Map();
  const ensureMonth = (year, month) => {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (!monthsByKey.has(key)) {
      const totalDays = new Date(year, month, 0).getDate();
      monthsByKey.set(key, {
        title: `${month}/${year}`,
        year,
        month,
        days: Array.from({ length: totalDays }, (_, index) => ({
          day: index + 1,
          weekday: "",
          code: "",
          jle: ""
        }))
      });
    }
    return monthsByKey.get(key);
  };

  for (const match of html.matchAll(/<a\b[^>]*href=["']javascript:selFecha\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)["'][^>]*>\s*(DS|SL|FS|VA)?\s*<\/a>/gi)) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const code = String(match[4] || "").toUpperCase();
    const monthData = ensureMonth(year, month);
    const dayData = monthData.days[day - 1];
    if (dayData) dayData.code = code;
  }

  const months = [...monthsByKey.values()]
    .map((monthData) => ({
      ...monthData,
      codes: monthData.days.map((day) => day.code).filter(Boolean)
    }))
    .sort((a, b) => (a.year - b.year) || (a.month - b.month));

  const allCodes = months.flatMap((month) => month.days.map((day) => day.code).filter(Boolean));
  return {
    worker,
    months,
    totals: allCodes.reduce((acc, code) => {
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {})
  };
}

function parsePrimas(html = "") {
  const pageText = textFromHtml(html);
  const rows = parseRowsFromTable(html);
  const headerIndex = rows.findIndex((row) => (
    row.some((cell) => /jornal/i.test(cell))
    && row.some((cell) => /producci/i.test(cell))
  ));

  if (headerIndex === -1) {
    return {
      locked: /clave\s+de\s+seguridad|validar/i.test(pageText),
      monthLabel: pageText.match(/Jornales\s+de\s+([^\n|]+)/i)?.[1]?.trim() || "",
      rows: rows
        .filter((row) => row.length > 1)
        .map((row) => ({ values: row }))
    };
  }

  const headers = rows[headerIndex].map((item) => item.toLowerCase());
  const indexOf = (pattern, fallback) => {
    const index = headers.findIndex((item) => pattern.test(item));
    return index === -1 ? fallback : index;
  };

  return {
    locked: false,
    monthLabel: pageText.match(/Jornales\s+de\s+([^\n|]+)/i)?.[1]?.trim() || "",
    rows: rows.slice(headerIndex + 1)
      .filter((row) => row.length >= 6 && /^\d+$/.test(String(row[0] || "")))
      .map((row) => ({
        values: row,
        jornal: row[indexOf(/jornal/, 0)] || "",
        parte: row[indexOf(/parte/, 1)] || "",
        dia: row[indexOf(/^dia$/, 2)] || "",
        tipo: row[indexOf(/tipo/, 3)] || "",
        jornada: row[indexOf(/jornada/, 4)] || "",
        especialidad: row[indexOf(/especialidad/, 5)] || "",
        empresa: row[indexOf(/empresa/, 6)] || "",
        buque: row[indexOf(/buque/, 7)] || "",
        operacion: row[indexOf(/operaci/, 8)] || "",
        produccion: row[indexOf(/producci/, 9)] || ""
      }))
  };
}

async function writeStatus(status) {
  await fs.mkdir(privateDataDir, { recursive: true });
  await fs.writeFile(STATUS_PATH, JSON.stringify(status, null, 2), "utf8");
}

function findMenuItem(page, text) {
  return page.locator(".norayService:visible, .gwt-TreeItem:visible", { hasText: text }).first();
}

async function ensureExpanded(page, group, child) {
  const childItem = findMenuItem(page, child);
  if (await childItem.isVisible().catch(() => false)) return;

  const groupItem = page.locator(".gwt-TreeItem:visible", { hasText: group }).first();
  await groupItem.waitFor({ state: "visible", timeout: 30000 });
  await groupItem.click({ timeout: 10000 });
  await childItem.waitFor({ state: "visible", timeout: 10000 });
}

async function waitForFrame(page, pattern, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const frame = findFrame(page, pattern);
    if (frame) return frame;
    await page.waitForTimeout(150);
  }
  throw new Error(`No se cargo la pantalla esperada: ${pattern}`);
}

async function waitForFrameText(page, pattern, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const text = await frame.locator("body").innerText().catch(() => "");
      if (pattern.test(text)) return frame;
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`No se cargo el contenido esperado: ${pattern}`);
}

async function waitForFrameLocator(page, getLocator, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const locator = getLocator(frame).first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
    await page.waitForTimeout(200);
  }
  return null;
}

async function waitForParsedContent(page, parser, score, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let bestResult = parser("");
  let bestScore = score(bestResult);

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const result = parser(await frame.content().catch(() => ""));
      const resultScore = score(result);
      if (resultScore > bestScore) {
        bestResult = result;
        bestScore = resultScore;
      }
    }
    if (bestScore > 0) return bestResult;
    await page.waitForTimeout(200);
  }

  return bestResult;
}

async function login(page) {
  await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.getByRole("button", { name: "Entendido" }).click({ timeout: 1500 }).catch(() => {});

  let body = await page.locator("body").innerText().catch(() => "");
  if (/Finalizar sesi|LUJAN MARIN|Usuario/i.test(body) && /Finalizar sesi/i.test(body)) return;

  if (!portalUser || !portalPassword) {
    throw new Error("Faltan CPE_PORTAL_USER y CPE_PORTAL_PASSWORD para iniciar sesion.");
  }

  const visibleInputs = page.locator("input:visible");
  const userInput = page.locator('input[title="Usuario"]:visible').or(visibleInputs.nth(0)).first();
  const passwordInput = page.locator('input[title*="Contrase"]:visible').or(visibleInputs.nth(1)).first();
  await userInput.fill(portalUser, { timeout: 45000 });
  await passwordInput.fill(portalPassword, { timeout: 15000 });
  await page.getByRole("button", { name: /Iniciar sesi/i }).click();
  const logoutButton = page.locator("button:visible", { hasText: /Finalizar sesi/i }).first();
  const userHeader = page.getByText(new RegExp(`^\\s*${portalUser}\\s*-`)).first();
  const serviceMenu = page.locator(".norayService:visible").first();
  await Promise.race([
    logoutButton.waitFor({ state: "visible", timeout: 45000 }),
    userHeader.waitFor({ state: "visible", timeout: 45000 }),
    serviceMenu.waitFor({ state: "visible", timeout: 45000 })
  ]);

  body = await page.locator("body").innerText().catch(() => "");
  const authenticated = await logoutButton.isVisible().catch(() => false)
    || await userHeader.isVisible().catch(() => false)
    || await serviceMenu.isVisible().catch(() => false);
  if (!authenticated) {
    throw new Error("No se pudo iniciar sesion en el portal oficial.");
  }
}

async function openMenu(page, group, text, framePattern) {
  await ensureExpanded(page, group, text);
  const item = findMenuItem(page, text);
  await item.scrollIntoViewIfNeeded().catch(() => {});
  await item.click({ timeout: 10000 });
  if (framePattern) await waitForFrame(page, framePattern);
}

function findFrame(page, pattern) {
  return page.frames().find((frame) => pattern.test(frame.url()));
}

async function collectJornales(page) {
  await openMenu(page, "Consultas", "Consulta de jornales", /SelDatJor1\.asp/i);
  const frame = await waitForFrame(page, /SelDatJor1\.asp/i);
  await frame.getByRole("button", { name: /Aceptar/i }).click();
  const resultFrame = await waitForFrame(page, /Jornales1\.asp/i);
  return parseJornales(await resultFrame.content());
}

async function collectDescansos(page) {
  await openMenu(page, "Solicitudes", "Solicitar Descansos", /Prueba\.asp/i);
  return waitForParsedContent(
    page,
    parseDescansos,
    (result) => (result.months?.length || 0) * 100 + (result.worker?.chapa ? 1 : 0)
  );
}

async function collectSl(page) {
  await openMenu(page, "Consultas", "Consulta posicion SL", /MostrarSL\.asp/i);
  const frame = await waitForFrame(page, /MostrarSL\.asp/i);
  return parseSl(await frame.content());
}

async function collectPrimas(page) {
  if (!portalSecurityKey) return { locked: true, rows: [] };
  await openMenu(page, "Consultas", "Consulta de Primas Productividad");
  const securityFrame = await waitForFrameText(page, /clave\s+de\s+seguridad[\s\S]*validar/i);
  await securityFrame.locator('input[type="password"]:visible').first().fill(portalSecurityKey);
  await securityFrame.getByRole("button", { name: /Validar/i }).click({ noWaitAfter: true });

  const accept = await waitForFrameLocator(
    page,
    (frame) => frame.getByRole("button", { name: /Aceptar/i }),
    8000
  );
  if (accept) {
    await accept.click({ noWaitAfter: true });
  }

  return waitForParsedContent(
    page,
    parsePrimas,
    (result) => (result.rows || []).filter((row) => row.jornal).length * 1000
      + (result.monthLabel ? 100 : 0),
    15000
  );
}

async function upsertSupabase(snapshot) {
  if (!supabaseServiceRole) return;
  const response = await fetch(`${resolveSupabaseUrl(supabaseUrl)}/rest/v1/app_cpe_portal_snapshots?on_conflict=chapa`, {
    method: "POST",
    headers: {
      "apikey": supabaseServiceRole,
      "Authorization": `Bearer ${supabaseServiceRole}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      chapa: snapshot.chapa,
      source: snapshot.source,
      payload: snapshot.payload,
      updated_at: snapshot.updatedAt
    })
  });

  if (!response.ok) {
    throw new Error(`Supabase HTTP ${response.status}: ${await response.text()}`);
  }
}

async function main() {
  await fs.mkdir(privateDataDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });

  const launchOptions = {
    headless,
    viewport: { width: 1500, height: 1100 },
    args: ["--disable-blink-features=AutomationControlled"]
  };
  if (browserChannel && browserChannel !== "bundled") {
    launchOptions.channel = browserChannel;
  }

  const context = await chromium.launchPersistentContext(profileDir, launchOptions);
  const page = context.pages()[0] || await context.newPage();

  try {
    await login(page);
    const updatedAt = new Date().toISOString();
    const payload = {
      jornales: await collectJornales(page),
      descansos: await collectDescansos(page),
      sl: await collectSl(page),
      primas: await collectPrimas(page)
    };

    const snapshot = {
      chapa: portalUser,
      source: PORTAL_URL,
      updatedAt,
      payload
    };

    await fs.writeFile(path.join(privateDataDir, `portal-${portalUser}.json`), JSON.stringify(snapshot, null, 2), "utf8");
    await upsertSupabase(snapshot);
    await writeStatus({
      ok: true,
      chapa: portalUser,
      updatedAt,
      supabaseConfigured: Boolean(supabaseServiceRole),
      jornales: payload.jornales.rows.length,
      sl: payload.sl.rows.length,
      primas: payload.primas.rows.length,
      descansos: payload.descansos.worker
    });
    console.log(`OK: portal oficial sincronizado para ${portalUser}`);
  } catch (error) {
    await writeStatus({
      ok: false,
      chapa: portalUser || null,
      updatedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : "Error desconocido"
    });
    throw error;
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Error desconocido");
  process.exit(1);
});
