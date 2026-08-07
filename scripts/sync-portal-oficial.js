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

function parseFs(html = "") {
  const pageText = textFromHtml(html);
  const rows = parseRowsFromTable(html);
  return {
    title: pageText.match(/FS\s+FESTIVOS\s+SELECCIONADOS/i)?.[0] || "FS FESTIVOS SELECCIONADOS",
    rows: rows.filter((row) => row.length > 1)
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
  return page.locator(".gwt-TreeItem:visible", { hasText: text }).first();
}

async function ensureExpanded(page, group, child) {
  if (await page.locator(".gwt-TreeItem:visible", { hasText: child }).count()) return;
  await findMenuItem(page, group).click({ timeout: 8000 });
  await page.waitForTimeout(800);
}

async function login(page) {
  await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(5000);
  await page.getByRole("button", { name: "Entendido" }).click().catch(() => {});

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
  await page.waitForTimeout(8000);

  body = await page.locator("body").innerText().catch(() => "");
  if (!/Finalizar sesi/i.test(body)) {
    throw new Error("No se pudo iniciar sesion en el portal oficial.");
  }
}

async function openMenu(page, group, text) {
  await ensureExpanded(page, group, text);
  const item = findMenuItem(page, text);
  await item.scrollIntoViewIfNeeded().catch(() => {});
  await item.click({ timeout: 10000 });
  await page.waitForTimeout(3500);
}

function findFrame(page, pattern) {
  return page.frames().find((frame) => pattern.test(frame.url()));
}

async function getFrameHtml(page, pattern) {
  const frame = findFrame(page, pattern);
  if (!frame) return "";
  return frame.content();
}

async function collectJornales(page) {
  await openMenu(page, "Consultas", "Consulta de jornales");
  const frame = findFrame(page, /SelDatJor1\.asp/i);
  if (!frame) return { monthLabel: "", rows: [] };
  await frame.getByRole("button", { name: /Aceptar/i }).click();
  await page.waitForTimeout(3500);
  return parseJornales(await getFrameHtml(page, /Jornales1\.asp/i));
}

async function collectDescansos(page) {
  await openMenu(page, "Solicitudes", "Solicitar Descansos");
  return parseDescansos(await getFrameHtml(page, /Prueba\.asp/i));
}

async function collectSl(page) {
  await openMenu(page, "Consultas", "Consulta posicion SL");
  return parseSl(await getFrameHtml(page, /MostrarSL\.asp/i));
}

async function collectFs(page) {
  await openMenu(page, "Consultas", "Consulta FS");
  return parseFs(await getFrameHtml(page, /MostrarFAFS\.asp/i));
}

async function collectPrimas(page) {
  if (!portalSecurityKey) return { locked: true, rows: [] };
  await openMenu(page, "Consultas", "Consulta de Primas Productividad");
  const passwordInput = page.locator('input[type="password"]:visible').first();
  if (await passwordInput.count()) {
    await passwordInput.fill(portalSecurityKey);
    await page.getByRole("button", { name: /Validar/i }).click();
    await page.waitForTimeout(3500);
  }

  const selectorFrame = page.frames().find((item) => /SelDatJorPrimas\.asp/i.test(item.url()));
  if (selectorFrame) {
    const accept = selectorFrame.getByRole("button", { name: /Aceptar/i });
    if (await accept.count()) {
      await accept.click();
      await page.waitForTimeout(4000);
    }
  }

  const frame = page.frames().find((item) => /JornalesPrimas|JorPrimas|Primas|Jornales/i.test(item.url()) && !/SelDatJorPrimas/i.test(item.url()))
    || page.frames().find((item) => /Noray|portal\.cpevalencia/i.test(item.url()) && !/#User/.test(item.url()) && !/SelDatJorPrimas/i.test(item.url()))
    || page.frames().find((item) => /SelDatJorPrimas/i.test(item.url()));

  return parsePrimas(frame ? await frame.content() : await page.content());
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

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless,
    viewport: { width: 1500, height: 1100 },
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    await login(page);
    const updatedAt = new Date().toISOString();
    const payload = {
      jornales: await collectJornales(page),
      descansos: await collectDescansos(page),
      sl: await collectSl(page),
      fs: await collectFs(page),
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
