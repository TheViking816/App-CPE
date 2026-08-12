import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  assignmentDetailScore,
  isAssignmentDetailComplete,
  parseAssignmentDetailFromTables,
  parseAssignmentsFromTables
} from "./portal-assignments.js";
import { parseVacacionesFromRows } from "./portal-vacations.js";

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

  if (headerIndex === -1) return { recognized: Boolean(monthLabel), monthLabel, rows: [] };

  const headers = rows[headerIndex].map((item) => item.toLowerCase());
  const indexOf = (pattern, fallback) => {
    const index = headers.findIndex((item) => pattern.test(item));
    return index === -1 ? fallback : index;
  };

  return {
    recognized: true,
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

  if (headerIndex === -1) return { recognized: false, rows: [] };

  return {
    recognized: true,
    rows: rows.slice(headerIndex + 1)
      .filter((row) => /^\d{2}\/\d{2}\/\d{4}$/.test(row[0] || ""))
      .map((row) => ({ fecha: row[0], posicion: row[1] || "" }))
  };
}

function parseAssignments(html = "") {
  return parseAssignmentsFromTables([parseRowsFromTable(html)], textFromHtml(html));
}

function parseAssignmentDetail(html = "") {
  return parseAssignmentDetailFromTables([parseRowsFromTable(html)], textFromHtml(html));
}

function parseVacaciones(html = "") {
  return parseVacacionesFromRows(parseRowsFromTable(html), textFromHtml(html));
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

function exactTextPattern(text) {
  const rawText = String(text);
  const normalizedText = /Ã|Â/.test(rawText)
    ? Buffer.from(rawText, "latin1").toString("utf8")
    : rawText;
  const escaped = normalizedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*${escaped}\\s*$`, "i");
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

function findMenuItem(page, text, timeout = 0) {
  return findVisibleMatchAcrossFrames(page, ".NorayMenu .gwt-TreeItem", text, timeout);
}

async function findVisibleMatchAcrossFrames(page, selector, text, timeout = 0) {
  const deadline = Date.now() + timeout;
  const pattern = exactTextPattern(text);

  do {
    for (const root of [page, ...page.frames()]) {
      const matches = root.locator(selector).filter({ hasText: pattern });
      const count = await matches.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const candidate = matches.nth(index);
        if (await candidate.isVisible().catch(() => false)) return candidate;
      }
    }
    if (Date.now() < deadline) await page.waitForTimeout(150);
  } while (Date.now() < deadline);

  return null;
}

async function ensureExpanded(page, group, child) {
  if (await findMenuItem(page, child)) return;

  const groupItem = await findVisibleMatchAcrossFrames(page, ".gwt-TreeItem", group, 30000);
  if (!groupItem) throw new Error(`No se encontro el menu visible: ${group}`);

  await groupItem.scrollIntoViewIfNeeded();
  await groupItem.click({ timeout: 10000 });

  const childItem = await findMenuItem(page, child, 10000);
  if (!childItem) throw new Error(`No se encontro la opcion visible: ${child}`);
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

async function waitForFrameAndLocator(page, getLocator, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const locator = getLocator(frame).first();
      if (await locator.isVisible().catch(() => false)) return { frame, locator };
    }
    await page.waitForTimeout(200);
  }
  return null;
}

async function waitForParsedContent(page, parser, score, timeout = 12000, isComplete = (_result, resultScore) => resultScore > 0) {
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
    if (isComplete(bestResult, bestScore)) return bestResult;
    await page.waitForTimeout(200);
  }

  return bestResult;
}

async function waitForParsedFrame(page, pattern, parser, score, timeout = 8000) {
  const frame = await waitForFrame(page, pattern, timeout);
  const deadline = Date.now() + timeout;
  let bestResult = parser("");
  let bestScore = score(bestResult);

  while (Date.now() < deadline) {
    const result = parser(await frame.content().catch(() => ""));
    const resultScore = score(result);
    if (resultScore > bestScore) {
      bestResult = result;
      bestScore = resultScore;
    }
    if (bestScore > 0) return bestResult;
    await page.waitForTimeout(150);
  }

  return bestResult;
}

async function readDirectPortalPage(context, url, parser, score, timeout = 8000) {
  const directPage = await context.newPage();
  try {
    await directPage.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    const deadline = Date.now() + timeout;
    let bestResult = parser("");
    let bestScore = score(bestResult);

    while (Date.now() < deadline) {
      const result = parser(await directPage.content().catch(() => ""));
      const resultScore = score(result);
      if (resultScore > bestScore) {
        bestResult = result;
        bestScore = resultScore;
      }
      if (bestScore > 0) return bestResult;
      await directPage.waitForTimeout(150);
    }

    return bestResult;
  } finally {
    await directPage.close();
  }
}

async function readAssignmentDetailViaPortal(sourcePage, assignment) {
  const year = String(assignment.fecha || "").match(/\b(20\d{2})\b/)?.[1]
    || String(new Date().getFullYear());
  const detailUrl = new URL("https://portal.cpevalencia.com/Noray/ParteA.asp");
  detailUrl.searchParams.set("anyo", year);
  detailUrl.searchParams.set("parte", String(assignment.parte));

  await sourcePage.goto(detailUrl.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 20000
  });

  return waitForParsedContent(
    sourcePage,
    parseAssignmentDetail,
    assignmentDetailScore,
    12000,
    isAssignmentDetailComplete
  );
}

async function readPortalAuthState(page) {
  const roots = [page, ...page.frames()];
  const textParts = [];
  let loginVisible = false;
  let authenticatedControlVisible = false;

  for (const root of roots) {
    const text = await root.locator("body").innerText().catch(() => "");
    if (text) textParts.push(text);

    const loginButton = root.getByRole("button", { name: /Iniciar sesi/i }).first();
    if (await loginButton.isVisible().catch(() => false)) loginVisible = true;

    const logoutButton = root.getByRole("button", { name: /Finalizar sesi/i }).first();
    const logoutInput = root.locator('input[value*="Finalizar sesi" i]:visible').first();
    const serviceMenu = root.locator(".norayService:visible").first();
    if (
      await logoutButton.isVisible().catch(() => false)
      || await logoutInput.isVisible().catch(() => false)
      || await serviceMenu.isVisible().catch(() => false)
    ) {
      authenticatedControlVisible = true;
    }
  }

  const body = cleanText(textParts.join("\n"));
  const normalizedBody = body.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const securityChallenge = /Verificacion de seguridad|verifica que tu no eres un bot|Ray ID|challenges\.cloudflare/i.test(normalizedBody);
  if (securityChallenge) return "security_challenge";
  const rejected = /(?:usuario|contrasena|credenciales?).{0,45}(?:incorrect|invalid|errone)|acceso\s+denegado|no\s+se\s+ha\s+podido\s+identificar/i.test(normalizedBody);
  if (rejected) return "rejected";

  const userPattern = new RegExp(`(?:^|\\s)${portalUser}\\s*-`, "m");
  const authenticatedText = /Finalizar sesion/i.test(normalizedBody)
    || userPattern.test(body)
    || (/Consultas/i.test(body) && !loginVisible);
  if (authenticatedControlVisible || authenticatedText) return "authenticated";
  return loginVisible ? "login" : "pending";
}

async function waitForPortalEntry(page, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let state = "pending";

  while (Date.now() < deadline) {
    state = await readPortalAuthState(page);
    if (state === "authenticated" || state === "login" || state === "rejected") return state;
    await page.waitForTimeout(250);
  }

  return state;
}

async function waitForPortalAuthState(page, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let state = "pending";

  while (Date.now() < deadline) {
    state = await readPortalAuthState(page);
    if (state === "authenticated" || state === "rejected") return state;
    await page.waitForTimeout(250);
  }

  return state;
}

async function login(page, attempt = 0) {
  await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.getByRole("button", { name: "Entendido" }).click({ timeout: 1500 }).catch(() => {});

  const entryState = await waitForPortalEntry(page);
  if (entryState === "authenticated") return;
  if (entryState === "security_challenge") {
    if (attempt < 1) return login(page, attempt + 1);
    throw new Error("El portal oficial ha bloqueado temporalmente la lectura automatica. Vuelve a intentarlo en unos minutos.");
  }

  if (!portalUser || !portalPassword) {
    throw new Error("Faltan CPE_PORTAL_USER y CPE_PORTAL_PASSWORD para iniciar sesion.");
  }

  const loginForm = await waitForFrameAndLocator(
    page,
    (frame) => frame.locator('input[title="Usuario"]:visible, input[type="text"]:visible'),
    10000
  );
  if (!loginForm) {
    const state = await readPortalAuthState(page);
    if (state === "security_challenge") {
      throw new Error("El portal oficial ha bloqueado temporalmente la lectura automatica. Vuelve a intentarlo en unos minutos.");
    }
    throw new Error("El portal oficial no ha mostrado el formulario de acceso. Vuelve a intentarlo.");
  }

  const { frame: loginFrame, locator: userInput } = loginForm;
  const passwordInput = loginFrame.locator('input[title*="Contrase"]:visible, input[type="password"]:visible').first();
  const loginButton = loginFrame.getByRole("button", { name: /Iniciar sesi/i }).first();
  await userInput.fill(portalUser, { timeout: 45000 });
  await passwordInput.fill(portalPassword, { timeout: 15000 });
  await loginButton.click({ timeout: 15000 });
  const state = await waitForPortalAuthState(page);
  if (state === "authenticated") return;
  if (state === "rejected") {
    throw new Error("Usuario o contrasena del portal oficial incorrectos.");
  }
  if (attempt < 1) return login(page, attempt + 1);
  throw new Error("El portal oficial no confirmo el inicio de sesion a tiempo. Vuelve a intentarlo.");
}

async function openMenu(page, group, text, framePattern) {
  const childItem = await findMenuItem(page, text);
  const groupItem = await findVisibleMatchAcrossFrames(page, ".gwt-TreeItem", group);
  if (!childItem && !groupItem) {
    // Result pages hide the navigation tree. Reloading the portal root keeps the
    // authenticated session and restores the menu before reading the next section.
    await login(page);
  }
  await ensureExpanded(page, group, text);
  const item = await findMenuItem(page, text, 10000);
  if (!item) throw new Error(`No se encontro la opcion visible: ${text}`);
  await item.scrollIntoViewIfNeeded();
  await item.click({ timeout: 10000 });
  if (framePattern) await waitForFrame(page, framePattern);
}

function findFrame(page, pattern) {
  return page.frames().find((frame) => pattern.test(frame.url()));
}

function safePortalLocation(value = "") {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "unknown";
  }
}

async function assignmentNavigationState(page, stage) {
  const frames = await Promise.all(page.frames().map(async (frame) => ({
    location: safePortalLocation(frame.url()),
    menuItems: await frame.locator(".NorayMenu .gwt-TreeItem, .gwt-TreeItem").count().catch(() => 0),
    partLabels: await frame.locator("td, th").filter({ hasText: /^\s*Parte:?\s*$/i }).count().catch(() => 0)
  })));
  console.log(`[contratacion:${stage}] ${JSON.stringify({ page: safePortalLocation(page.url()), frames })}`);
}

const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

async function selectPortalOption(select, expectedLabel) {
  const options = await select.locator("option").evaluateAll((nodes) => nodes.map((node) => ({
    label: String(node.textContent || "").trim(),
    value: node.value
  })));
  const normalizedExpected = expectedLabel.toLocaleLowerCase("es");
  const match = options.find((option) => option.label.toLocaleLowerCase("es") === normalizedExpected)
    || options.find((option) => option.label.toLocaleLowerCase("es").includes(normalizedExpected));
  if (!match) throw new Error(`No se encontro el periodo ${expectedLabel} en Consulta de jornales.`);
  await select.selectOption(match.value);
}

async function collectJornales(page, previous = null) {
  await openMenu(page, "Consultas", "Consulta de jornales", /SelDatJor1\.asp/i);
  const now = new Date();
  const year = Number(process.env.CPE_PORTAL_HISTORY_YEAR || now.getFullYear());
  const currentMonth = year === now.getFullYear() ? now.getMonth() + 1 : 12;
  const previousHistory = Array.isArray(previous?.history)
    ? previous.history.filter((period) => Number(period?.year) === year && Array.isArray(period?.rows) && period.rows.length > 0)
    : [];
  // The portal keeps old GWT frames alive after returning from a result page.
  // Reading several periods in one session can therefore resolve a stale,
  // empty frame. Keep the regular sync scoped to the current month; historical
  // periods are accumulated only from confirmed, non-empty reads.
  const monthsToRead = [currentMonth];
  const historyByMonth = new Map(previousHistory.map((period) => [Number(period.month), period]));

  for (const [index, month] of monthsToRead.entries()) {
    const selectorFrame = await waitForFrame(page, /SelDatJor1\.asp/i);
    const selects = selectorFrame.locator("select");
    if (await selects.count() < 2) throw new Error("No se encontraron los selectores de mes y ano de jornales.");
    await selectPortalOption(selects.nth(0), MONTH_NAMES_ES[month - 1]);
    await selectPortalOption(selects.nth(1), String(year));
    await selectorFrame.getByRole("button", { name: /Aceptar/i }).click();

    const resultFrame = await waitForFrame(page, /Jornales1\.asp/i);
    const parsed = parseJornales(await resultFrame.content());
    const parsedRows = Array.isArray(parsed.rows) ? parsed.rows : [];
    const previousPeriod = historyByMonth.get(month);
    if (parsedRows.length > 0 || !previousPeriod) {
      historyByMonth.set(month, {
        year,
        month,
        monthLabel: parsed.monthLabel || `${MONTH_NAMES_ES[month - 1]} de ${year}`,
        rows: parsedRows
      });
    }

    if (index < monthsToRead.length - 1) {
      await resultFrame.getByRole("button", { name: /Volver/i }).click();
      await waitForFrame(page, /SelDatJor1\.asp/i);
    }
  }

  const history = [...historyByMonth.values()].sort((left, right) => Number(left.month) - Number(right.month));
  const current = historyByMonth.get(currentMonth)
    || (Array.isArray(previous?.rows) && previous.rows.length > 0 ? previous : null)
    || { monthLabel: "", rows: [] };
  return {
    recognized: true,
    year,
    monthLabel: current.monthLabel,
    rows: current.rows,
    history
  };
}

async function collectDescansos(page) {
  await openMenu(page, "Solicitudes", "Solicitar Descansos", /Prueba\.asp/i);
  const calendarFrame = await waitForFrame(page, /Prueba\.asp/i, 12000);
  let result = await waitForParsedContent(
    page,
    parseDescansos,
    (result) => result.months?.length || 0,
    12000
  );
  if (result.months?.length) return result;

  const directPage = await page.context().newPage();
  try {
    await directPage.goto(calendarFrame.url(), {
      waitUntil: "domcontentloaded",
      timeout: 12000
    });
    result = await waitForParsedContent(
      directPage,
      parseDescansos,
      (parsed) => parsed.months?.length || 0,
      8000
    );
    if (result.months?.length) return result;
  } finally {
    await directPage.close();
  }

  throw new Error("No se pudo leer el calendario de descansos. Se conservaran los ultimos datos disponibles.");
}

async function collectSl(page) {
  await openMenu(page, "Consultas", "Consulta posicion SL", /MostrarSL\.asp/i);
  const frame = await waitForFrame(page, /MostrarSL\.asp/i);
  const parsed = parseSl(await frame.content());
  return { ...parsed, recognized: true };
}

async function collectAssignmentsViaMenu(page) {
  await assignmentNavigationState(page, "menu-before");
  await openMenu(page, "Consultas", "¿Dónde voy? - Orden Servicio");
  await assignmentNavigationState(page, "menu-after-click");
  const result = await waitForParsedFrame(
    page,
    /DondeVoy\.asp/i,
    parseAssignments,
    (parsed) => parsed.rows?.length || 0,
    8000
  );
  if (result.recognized && result.rows?.length) return result;
  throw new Error("No se pudo leer la contratacion actual. Se conservaran los ultimos datos disponibles.");
}

async function collectVacacionesViaMenu(page) {
  await openMenu(page, "Solicitudes", "Solicitud Vacaciones");
  const result = await waitForParsedFrame(
    page,
    /VacacionesC24\.asp/i,
    parseVacaciones,
    (parsed) => parsed.rows?.length || 0,
    8000
  );
  if (result.recognized && result.rows?.length) return result;
  throw new Error("No se pudo leer la solicitud de vacaciones. Se conservaran los ultimos datos disponibles.");
}

async function enrichAssignmentsWithDetails(context, result, previousResult) {
  const previousByPart = new Map((previousResult?.rows || [])
    .filter((item) => item.parte && item.detail?.recognized)
    .map((item) => [String(item.parte), item.detail]));
  const rows = [...(result?.rows || [])];
  const sourcePage = await context.newPage();
  try {
    await sourcePage.goto("https://portal.cpevalencia.com/Noray/DondeVoy.asp", {
      waitUntil: "domcontentloaded",
      timeout: 20000
    });

    for (let index = 0; index < rows.length; index += 1) {
      const item = rows[index];
      let detail = previousByPart.get(String(item.parte)) || null;
      try {
        const freshDetail = await readAssignmentDetailViaPortal(sourcePage, item);
        if (freshDetail.recognized) {
          detail = freshDetail;
          console.log(`Parte ${item.parte}: ${freshDetail.specialties.length} especialidades leidas.`);
        } else {
          console.warn(`Parte ${item.parte}: la ventana se abrio, pero no contenia un equipo reconocible.`);
        }
      } catch (error) {
        console.warn(`Parte ${item.parte}: no se pudo leer el detalle. ${error instanceof Error ? error.message : "Error desconocido"}`);
        // Keep the previous detail when the legacy portal fails to open a part.
      }
      if (detail) rows[index] = { ...item, detail };
    }
  } finally {
    await sourcePage.close().catch(() => {});
  }

  return { ...result, rows };
}

async function collectAssignments(page, previousResult) {
  let result;
  try {
    await assignmentNavigationState(page, "direct-before");
    result = await readDirectPortalPage(
      page.context(),
      "https://portal.cpevalencia.com/Noray/DondeVoy.asp",
      parseAssignments,
      (parsed) => parsed.rows?.length || 0,
      8000
    );
    console.log(`[contratacion:direct-result] ${JSON.stringify({ recognized: result.recognized, rows: result.rows?.length || 0 })}`);
    if (!(result.recognized && result.rows?.length)) result = null;
  } catch (error) {
    console.warn(`[contratacion:direct-error] ${error instanceof Error ? error.message : "Error desconocido"}`);
    // The menu fallback handles portal-side route changes.
  }
  if (!result) result = await collectAssignmentsViaMenu(page);
  return enrichAssignmentsWithDetails(page.context(), result, previousResult);
}

async function collectVacaciones(page) {
  try {
    const result = await readDirectPortalPage(
      page.context(),
      "https://portal.cpevalencia.com/Noray/src/VacacionesC24UniVac/VacacionesC24.asp",
      parseVacaciones,
      (parsed) => parsed.rows?.length || 0,
      8000
    );
    if (result.recognized && result.rows?.length) return result;
  } catch {
    // The menu fallback handles portal-side route changes.
  }
  return collectVacacionesViaMenu(page);
}

async function collectPrimas(page) {
  if (!portalSecurityKey) return { locked: true, rows: [] };
  await openMenu(page, "Consultas", "Consulta de Primas Productividad");
  const securityControl = await waitForFrameAndLocator(
    page,
    (frame) => frame.getByRole("button", { name: /Validar/i }),
    10000
  );

  if (!securityControl) {
    const alreadyLoaded = await waitForParsedContent(
      page,
      parsePrimas,
      (result) => (result.rows || []).filter((row) => row.jornal).length,
      3000
    );
    if ((alreadyLoaded.rows || []).some((row) => row.jornal)) return alreadyLoaded;
    throw new Error("No se encontro la validacion de la clave de primas.");
  }

  const securityInput = securityControl.frame
    .locator('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([role="presentation"]):not([tabindex="-1"]):visible')
    .first();
  await securityInput.click();
  await securityInput.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await securityInput.pressSequentially(portalSecurityKey, { delay: 80 });
  await securityInput.press("Tab");
  await securityControl.locator.click({ noWaitAfter: true });

  const invalidKey = await waitForFrameAndLocator(
    page,
    (frame) => frame.getByText(/La clave de seguridad es incorrecta/i),
    3000
  );
  if (invalidKey) {
    throw new Error("La clave de seguridad de primas es incorrecta. Cambia las claves guardadas e intentalo de nuevo.");
  }

  const accept = await waitForFrameLocator(
    page,
    (frame) => frame.getByRole("button", { name: /Aceptar/i }),
    8000
  );
  if (accept) {
    await accept.click({ noWaitAfter: true });
  }

  const result = await waitForParsedContent(
    page,
    parsePrimas,
    (result) => (result.rows || []).filter((row) => row.jornal).length * 1000
      + (result.monthLabel ? 100 : 0),
    15000
  );
  if (result.locked) {
    throw new Error("La clave de seguridad de primas no fue validada.");
  }
  return result;
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

async function getExistingSupabaseSnapshot() {
  if (!supabaseServiceRole || !portalUser) return null;
  try {
    const response = await fetch(
      `${resolveSupabaseUrl(supabaseUrl)}/rest/v1/app_cpe_portal_snapshots?select=payload&chapa=eq.${encodeURIComponent(portalUser)}&limit=1`,
      {
        headers: {
          apikey: supabaseServiceRole,
          Authorization: `Bearer ${supabaseServiceRole}`
        }
      }
    );
    if (!response.ok) return null;
    const rows = await response.json();
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

async function main() {
  await fs.mkdir(privateDataDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });

  const launchOptions = {
    headless,
    viewport: { width: 1500, height: 1100 },
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    args: ["--disable-blink-features=AutomationControlled"]
  };
  if (browserChannel && browserChannel !== "bundled") {
    launchOptions.channel = browserChannel;
  }

  const context = await chromium.launchPersistentContext(profileDir, launchOptions);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    await login(page);
    const updatedAt = new Date().toISOString();
    const existingSnapshot = await getExistingSupabaseSnapshot();
    const sectionWarnings = [];
    let freshSections = 0;
    const readSection = async (name, reader, fallback, emptyValue, isMeaningful) => {
      console.log(`Leyendo ${name}...`);
      try {
        const value = await reader();
        if (!isMeaningful || isMeaningful(value)) {
          freshSections += 1;
          console.log(`${name} actualizado.`);
          return value;
        }
        const message = `${name} devolvio una respuesta vacia; se conservan los datos anteriores.`;
        sectionWarnings.push(message);
        console.warn(message);
      } catch (error) {
        const message = `${name} no se pudo actualizar; se conservan los datos anteriores. ${error instanceof Error ? error.message : ""}`.trim();
        sectionWarnings.push(message);
        console.warn(message);
      }
      return isMeaningful(fallback) ? fallback : emptyValue;
    };
    const readOptionalSection = async (name, reader, fallback, emptyValue, isMeaningful) => {
      console.log(`Leyendo ${name}...`);
      try {
        const value = await reader();
        if (isMeaningful(value)) {
          freshSections += 1;
          console.log(`${name} actualizado.`);
          return value;
        }
        const message = `${name} no devolvio datos; se conserva la ultima lectura disponible.`;
        sectionWarnings.push(message);
        console.warn(message);
      } catch (error) {
        const message = `${name} no se pudo actualizar. ${error instanceof Error ? error.message : ""}`.trim();
        sectionWarnings.push(message);
        console.warn(message);
      }
      return isMeaningful(fallback) ? fallback : emptyValue;
    };

    const hasRows = (value) => Array.isArray(value?.rows) && value.rows.length > 0;
    const hasRecognizedRows = (value) => Boolean(value?.recognized) && Array.isArray(value?.rows);
    const hasMonths = (value) => Array.isArray(value?.months) && value.months.length > 0;
    const hasVacationData = (value) => Boolean(value?.recognized);
    const jornales = await readSection(
      "jornales",
      () => collectJornales(page, existingSnapshot?.payload?.jornales),
      existingSnapshot?.payload?.jornales,
      { monthLabel: "", rows: [] },
      hasRecognizedRows
    );
    const asignaciones = await readOptionalSection(
      "contratacion actual",
      () => collectAssignments(page, existingSnapshot?.payload?.asignaciones),
      existingSnapshot?.payload?.asignaciones,
      { recognized: false, rows: [] },
      hasVacationData
    );
    const primas = await readOptionalSection(
      "primas",
      () => collectPrimas(page),
      existingSnapshot?.payload?.primas,
      { locked: true, rows: [] },
      hasRows
    );
    const sl = await readSection(
      "lista SL",
      () => collectSl(page),
      existingSnapshot?.payload?.sl,
      { rows: [] },
      hasRecognizedRows
    );
    const descansos = await readSection(
      "descansos",
      () => collectDescansos(page),
      existingSnapshot?.payload?.descansos,
      { worker: { chapa: portalUser, name: "", group: "", currentMonthRest: 0, nextMonthRest: 0 }, months: [], totals: {} },
      hasMonths
    );
    const vacaciones = await readOptionalSection(
      "vacaciones",
      () => collectVacaciones(page),
      existingSnapshot?.payload?.vacaciones,
      { recognized: false, year: null, initialMonth: "", totalDays: 0, rows: [] },
      hasVacationData
    );
    if (freshSections === 0) {
      throw new Error("El portal no devolvio ninguna seccion util. Se conservaran los datos anteriores.");
    }

    const payload = {
      jornales,
      asignaciones,
      descansos,
      sl,
      primas,
      vacaciones,
      sync: {
        partial: sectionWarnings.length > 0,
        freshSections,
        warnings: sectionWarnings
      }
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
      asignaciones: payload.asignaciones.rows.length,
      sl: payload.sl.rows.length,
      primas: payload.primas.rows.length,
      descansos: payload.descansos.worker,
      vacaciones: payload.vacaciones.rows.length,
      partial: payload.sync.partial,
      warnings: payload.sync.warnings
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
