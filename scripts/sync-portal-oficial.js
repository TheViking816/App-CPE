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
import {
  buildRequestedDoubles,
  cleanMessageBodyText,
  currentMadridMonth,
  extractAddedMessageText,
  limitRecentPortalRows,
  parseMessagesHtml,
  parsePayrollsHtml,
  prioritizePortalMonths,
  upcomingMadridDates
} from "./portal-messages-doubles.js";

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
const portalSnapshotChannel = String(process.env.CPE_PORTAL_SNAPSHOT_CHANNEL
  || (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== "main" ? process.env.GITHUB_REF_NAME : "")).trim();
const headless = String(process.env.CPE_PORTAL_HEADLESS || "false").toLowerCase() !== "false";
const profileDir = path.resolve(process.env.CPE_PORTAL_PROFILE_DIR || "data/portal-oficial-chrome-profile");
const browserChannel = String(process.env.CPE_PORTAL_BROWSER_CHANNEL || "bundled").trim();
const fastMode = /^(1|true|yes)$/i.test(process.env.CPE_PORTAL_FAST_MODE || "");
const messageLimit = 5;
let collectedPayrollDocuments = [];

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

export function parseSl(html = "") {
  const rows = parseRowsFromTable(html);
  const headerIndex = rows.findIndex((row) => (
    row.some((cell) => /fecha/i.test(cell))
    && row.some((cell) => /posici|puesto|orden/i.test(cell))
  ));

  if (headerIndex === -1) return { recognized: false, rows: [] };

  const headers = rows[headerIndex].map((item) => cleanText(item).toLocaleLowerCase("es"));
  const dateIndex = Math.max(0, headers.findIndex((item) => /fecha/.test(item)));
  const positionIndex = headers.findIndex((item) => /posici|puesto|orden/.test(item));
  const normalizeDate = (value) => {
    const match = cleanText(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return match
      ? `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}/${match[3]}`
      : "";
  };

  return {
    recognized: true,
    rows: rows.slice(headerIndex + 1)
      .map((row) => ({
        fecha: normalizeDate(row[dateIndex] || ""),
        posicion: cleanText(row[positionIndex] || "").match(/\d+/)?.[0] || ""
      }))
      .filter((row) => row.fecha && row.posicion)
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
      recognized: Boolean(pageText.match(/Jornales\s+de\s+([^\n|]+)/i)),
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
    recognized: true,
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
  return findVisibleMatchAcrossFrames(page, ".NorayMenu .gwt-TreeItem, .gwt-TreeItem", text, timeout);
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
  // El arbol GWT no expande siempre al pulsar el texto: el portal indica que
  // hay que usar el icono Plus situado en la misma fila del grupo.
  const toggle = groupItem.locator("xpath=ancestor::tr[1]//img").first();
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click({ timeout: 10000 });
  } else {
    await groupItem.click({ timeout: 10000 });
  }

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
  await page.waitForTimeout(1200);
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

function jornalesPeriodMatches(monthLabel, month, year) {
  const normalizedLabel = cleanText(monthLabel).toLocaleLowerCase("es");
  return normalizedLabel.includes(MONTH_NAMES_ES[month - 1].toLocaleLowerCase("es"))
    && normalizedLabel.includes(String(year));
}

async function readJornalesPeriod(context, selectorUrl, month, year) {
  const periodPage = await context.newPage();
  const expectedLabel = `${MONTH_NAMES_ES[month - 1]} de ${year}`;
  const initialPages = new Set(context.pages());

  try {
    await periodPage.goto(selectorUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    const selects = periodPage.locator("select");
    if (await selects.count() < 2) {
      throw new Error(`No se encontraron los selectores para ${expectedLabel}.`);
    }

    await selectPortalOption(selects.nth(0), MONTH_NAMES_ES[month - 1]);
    await selectPortalOption(selects.nth(1), String(year));
    await periodPage.getByRole("button", { name: /Aceptar/i }).click({ noWaitAfter: true });

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      for (const candidatePage of context.pages()) {
        for (const root of [candidatePage, ...candidatePage.frames()]) {
          const parsed = parseJornales(await root.content().catch(() => ""));
          if (parsed.recognized && jornalesPeriodMatches(parsed.monthLabel, month, year)) {
            return {
              year,
              month,
              monthLabel: parsed.monthLabel || expectedLabel,
              rows: Array.isArray(parsed.rows) ? parsed.rows : []
            };
          }
        }
      }
      await periodPage.waitForTimeout(200);
    }

    throw new Error(`El portal no devolvio el periodo ${expectedLabel}.`);
  } finally {
    await Promise.all(context.pages()
      .filter((candidatePage) => !initialPages.has(candidatePage) && candidatePage !== periodPage)
      .map((candidatePage) => candidatePage.close().catch(() => {})));
    await periodPage.close();
  }
}

async function readPrimasPeriod(context, selectorUrl, month, year) {
  const periodPage = await context.newPage();
  const expectedLabel = `${MONTH_NAMES_ES[month - 1]} de ${year}`;
  const initialPages = new Set(context.pages());

  try {
    await periodPage.goto(selectorUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    const selects = periodPage.locator("select");
    if (await selects.count() < 2) {
      throw new Error(`No se encontraron los selectores de primas para ${expectedLabel}.`);
    }

    await selectPortalOption(selects.nth(0), MONTH_NAMES_ES[month - 1]);
    await selectPortalOption(selects.nth(1), String(year));
    await periodPage.getByRole("button", { name: /Aceptar/i }).click({ noWaitAfter: true });

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      for (const candidatePage of context.pages()) {
        for (const root of [candidatePage, ...candidatePage.frames()]) {
          const parsed = parsePrimas(await root.content().catch(() => ""));
          if (!parsed.locked && parsed.recognized && jornalesPeriodMatches(parsed.monthLabel, month, year)) {
            return {
              year,
              month,
              monthLabel: parsed.monthLabel || expectedLabel,
              rows: Array.isArray(parsed.rows) ? parsed.rows : []
            };
          }
        }
      }
      await periodPage.waitForTimeout(200);
    }

    throw new Error(`El portal no devolvio las primas de ${expectedLabel}.`);
  } finally {
    await Promise.all(context.pages()
      .filter((candidatePage) => !initialPages.has(candidatePage) && candidatePage !== periodPage)
      .map((candidatePage) => candidatePage.close().catch(() => {})));
    await periodPage.close();
  }
}

async function collectJornales(page, previous = null, { currentOnly = false } = {}) {
  await openMenu(page, "Consultas", "Consulta de jornales", /SelDatJor1\.asp/i);
  const now = new Date();
  const year = Number(process.env.CPE_PORTAL_HISTORY_YEAR || now.getFullYear());
  const currentMonth = year === now.getFullYear() ? now.getMonth() + 1 : 12;
  const previousHistory = Array.isArray(previous?.history)
    ? previous.history.filter((period) => (
        Number(period?.year) === year
        && Number(period?.month) >= 1
        && Number(period?.month) <= currentMonth
        && Array.isArray(period?.rows)
      ))
    : [];
  const historyByMonth = new Map(previousHistory.map((period) => [Number(period.month), period]));
  const availableMonths = Array.from({ length: currentMonth }, (_, index) => index + 1);
  const refreshFullHistory = /^(1|true|yes)$/i.test(process.env.CPE_PORTAL_REFRESH_HISTORY || "");
  const pendingMonths = currentOnly
    ? [currentMonth]
    : refreshFullHistory
      ? availableMonths
      : availableMonths.filter((month) => month === currentMonth || !historyByMonth.has(month));
  const monthsToRead = prioritizePortalMonths(pendingMonths, currentMonth);
  const selectorFrame = await waitForFrame(page, /SelDatJor1\.asp/i);
  const selectorUrl = selectorFrame.url();
  const periodWarnings = [];

  for (const month of monthsToRead) {
    try {
      const period = await readJornalesPeriod(page.context(), selectorUrl, month, year);
      historyByMonth.set(month, period);
      console.log(`Jornales ${period.monthLabel}: ${period.rows.length}.`);
    } catch (error) {
      const warning = `${MONTH_NAMES_ES[month - 1]} de ${year}: ${error instanceof Error ? error.message : "lectura fallida"}`;
      periodWarnings.push(warning);
      console.warn(`No se actualizaron los jornales de ${warning}`);
      if (month === currentMonth && historyByMonth.size === 0) {
        console.warn("Reintentando una vez los jornales del mes actual...");
        await page.waitForTimeout(800);
        try {
          const retryPeriod = await readJornalesPeriod(page.context(), selectorUrl, month, year);
          historyByMonth.set(month, retryPeriod);
          console.log(`Jornales ${retryPeriod.monthLabel}: ${retryPeriod.rows.length} (reintento).`);
          continue;
        } catch (retryError) {
          throw new Error(`El portal no devolvio los jornales del mes actual tras dos intentos. ${retryError instanceof Error ? retryError.message : warning}`);
        }
      }
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
    history,
    historyWarnings: periodWarnings
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
  const parsed = await waitForParsedContent(
    page,
    parseSl,
    (result) => result.rows?.length || 0,
    10000
  );
  if (parsed.rows?.length) return parsed;
  throw new Error("El portal no devolvio posiciones de Lista SL.");
}

async function openPortalHash(page, hash) {
  await login(page);
  const target = `https://portal.cpevalencia.com/#${hash}`;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);
}

async function collectMessages(page) {
  await openPortalHash(page, "User,Request,,,");
  await openMenu(page, "Consultas", "Mensajes");
  if (!/viewMessages/i.test(new URL(page.url()).hash)) {
    const messagesItem = await findMenuItem(page, "Mensajes", 3000);
    if (messagesItem) {
      await messagesItem.focus();
      await messagesItem.press("Enter").catch(() => {});
      await page.waitForTimeout(1200);
      if (!/viewMessages/i.test(new URL(page.url()).hash)) {
        await messagesItem.press("Space").catch(() => {});
        await page.waitForTimeout(1200);
      }
      if (!/viewMessages/i.test(new URL(page.url()).hash)) {
        await messagesItem.locator("xpath=..").click({ force: true }).catch(() => {});
        await page.waitForTimeout(1200);
      }
    }
  }
  if (!/viewMessages/i.test(new URL(page.url()).hash)) {
    await page.goto("https://portal.cpevalencia.com/#User,viewMessages,Home", {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });
    await page.waitForTimeout(1500);
  }
  await page.locator(".newsSignature").first().waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
  if (await page.locator(".newsSignature").count().catch(() => 0) === 0) {
    await openPortalHash(page, "User,Request,,,");
    await ensureExpanded(page, "Consultas", "Mensajes");
    const retryItem = await findMenuItem(page, "Mensajes", 10000);
    if (retryItem) {
      await retryItem.focus();
      await retryItem.press("Enter").catch(() => {});
      await page.waitForTimeout(800);
      if (await page.locator(".newsSignature").count().catch(() => 0) === 0) {
        await retryItem.press("Space").catch(() => {});
        await page.waitForTimeout(800);
      }
      if (await page.locator(".newsSignature").count().catch(() => 0) === 0) {
        await retryItem.locator("xpath=..").click({ force: true }).catch(() => {});
      }
      await page.locator(".newsSignature").first().waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
    }
  }
  const domMessages = await page.locator(".newsSignature").evaluateAll((signatures) => signatures.map((signature, index) => {
    const extractBody = (container, title, signatureText) => {
      const explicitBody = container?.querySelector(".newsText, .newsBody, [class*='newsText'], [class*='newsBody'], [class*='NewsText'], [class*='NewsBody'], [class*='content']");
      const visibleText = String(explicitBody?.innerText || explicitBody?.textContent || container?.innerText || container?.textContent || "");
      return visibleText
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .filter((line) => line !== title && line !== signatureText)
        .filter((line) => !/^\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\b.*(?:CPEV|LE[IÍ]DO)/i.test(line))
        .filter((line) => !/^(?:Eliminar|Borrar)$/i.test(line))
        .join("\n")
        .replace(/^\d+\s+/, "")
        .trim();
    };
    const signatureText = String(signature.textContent || "").replace(/\s+/g, " ").trim();
    const dateMatch = signatureText.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2})/);
    let container = signature.parentElement;
    for (let depth = 0; container && depth < 7; depth += 1, container = container.parentElement) {
      if (container.querySelector(".newsTitle, [class*='newsTitle'], [class*='NewsTitle']")) break;
    }
    container ||= signature.closest("tr") || signature.parentElement?.parentElement || signature.parentElement;
    const titleNode = container?.querySelector(".newsTitle, [class*='newsTitle'], [class*='NewsTitle'], [class*='title']");
    const title = String(titleNode?.textContent || "").replace(/\s+/g, " ").trim()
      || String(container?.textContent || "").replace(signatureText, "").replace(/^\s*\d+\s*/, "").replace(/\s+/g, " ").trim();
    if (!dateMatch || !title) return null;
    const tail = signatureText.slice((dateMatch.index || 0) + dateMatch[0].length).replace(/^\s*[-–—]\s*/, "");
    const readMatch = tail.match(/\bLE[IÍ]DO\s+EL\s+(.+)$/i);
    const sender = tail.replace(/\bLE[IÍ]DO\s+EL\s+.+$/i, "").replace(/[\s,.-]+$/, "").trim();
    const dateParts = dateMatch[1].split("/");
    const fullYear = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];
    const normalizedDate = `${dateParts[0].padStart(2, "0")}/${dateParts[1].padStart(2, "0")}/${fullYear}`;
    const containerText = extractBody(container, title, signatureText);
    return {
      id: `${dateMatch[1]}-${dateMatch[2]}-${index}-${title}`,
      title,
      date: normalizedDate,
      time: dateMatch[2].padStart(5, "0"),
      sender,
      read: Boolean(readMatch),
      readAt: String(readMatch?.[1] || "").trim(),
      body: containerText
    };
  }).filter(Boolean)).catch(() => []);
  if (domMessages.length) {
    const recentMessages = limitRecentPortalRows(domMessages, messageLimit);
    const titles = page.locator(".newsTitle, [class*='newsTitle'], [class*='NewsTitle']");
    const titleCount = await titles.count().catch(() => 0);
    const hydrated = [];
    for (let index = 0; index < recentMessages.length; index += 1) {
      const message = recentMessages[index];
      if (!message.body && index < titleCount) {
        const beforeOpen = await page.locator("body").innerText().catch(() => "");
        await titles.nth(index).click({ force: true, timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(180);
        const afterOpen = await page.locator("body").innerText().catch(() => "");
        message.body = extractAddedMessageText(beforeOpen, afterOpen, { title: message.title });
        if (!message.body) message.body = await page.locator(".newsSignature").nth(index).evaluate((signature, title) => {
          const signatureText = String(signature.textContent || "").replace(/\s+/g, " ").trim();
          let container = signature.parentElement;
          for (let depth = 0; container && depth < 7; depth += 1, container = container.parentElement) {
            const hasTitle = [...container.querySelectorAll(".newsTitle, [class*='newsTitle'], [class*='NewsTitle']")]
              .some((node) => String(node.textContent || "").replace(/\s+/g, " ").trim() === title);
            if (hasTitle) break;
          }
          const bodyNode = container?.querySelector(".newsText, .newsBody, [class*='newsText'], [class*='newsBody'], [class*='NewsText'], [class*='NewsBody'], [class*='content']");
          const visibleText = String(bodyNode?.innerText || bodyNode?.textContent || container?.innerText || container?.textContent || "");
          return visibleText
            .split(/\r?\n/)
            .map((line) => line.replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .filter((line) => line !== title && line !== signatureText)
            .filter((line) => !/^\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\b.*(?:CPEV|LE[IÍ]DO)/i.test(line))
            .filter((line) => !/^(?:Eliminar|Borrar)$/i.test(line))
            .join("\n")
            .replace(/^\d+\s+/, "")
            .trim();
        }, message.title).catch(() => "");
      }
      hydrated.push(message);
    }
    for (const message of hydrated) {
      message.body = cleanMessageBodyText(message.body, { title: message.title });
    }
    const uniqueMessages = [...new Map(hydrated.map((message) => [message.id, message])).values()];
    console.log(`Mensajes leidos: ${uniqueMessages.length} (${uniqueMessages.filter((message) => message.body).length} con contenido).`);
    return { recognized: true, rows: limitRecentPortalRows(uniqueMessages, messageLimit) };
  }
  const result = await waitForParsedContent(
    page,
    parseMessagesHtml,
    (parsed) => (parsed.recognized ? 1000 : 0) + (parsed.rows?.length || 0),
    10000,
    (parsed) => parsed.recognized && parsed.rows.length > 0
  );
  if (result.recognized && result.rows.length) {
    console.log(`Mensajes leidos: ${result.rows?.length || 0}.`);
    return { ...result, rows: limitRecentPortalRows(result.rows, messageLimit) };
  }

  for (const candidatePage of page.context().pages()) {
    if (candidatePage === page || candidatePage.isClosed()) continue;
    const popupResult = await waitForParsedContent(
      candidatePage,
      parseMessagesHtml,
      (parsed) => (parsed.recognized ? 1000 : 0) + (parsed.rows?.length || 0),
      3000,
      (parsed) => parsed.recognized && parsed.rows.length > 0
    );
    if (popupResult.recognized && popupResult.rows.length) {
      console.log(`Mensajes leidos: ${popupResult.rows.length}.`);
      return { ...popupResult, rows: limitRecentPortalRows(popupResult.rows, messageLimit) };
    }
  }

  const directPage = await page.context().newPage();
  try {
    await directPage.goto("https://portal.cpevalencia.com/ASP/client.asp", { waitUntil: "domcontentloaded", timeout: 45000 });
    await directPage.waitForTimeout(1200);
    const directResult = await waitForParsedContent(
      directPage,
      parseMessagesHtml,
      (parsed) => (parsed.recognized ? 1000 : 0) + (parsed.rows?.length || 0),
      5000,
      (parsed) => parsed.recognized && parsed.rows.length > 0
    );
    if (directResult.recognized && directResult.rows.length) {
      console.log(`Mensajes leidos: ${directResult.rows.length}.`);
      return { ...directResult, rows: limitRecentPortalRows(directResult.rows, messageLimit) };
    }
  } finally {
    await directPage.close();
  }

  throw new Error("No se pudo leer la bandeja de mensajes.");
}

async function extractPayrollRowsFromDom(page) {
  const titles = [];
  for (const frame of page.frames()) {
    const bodyText = await frame.locator("body").innerText().catch(() => "");
    titles.push(...[...String(bodyText).matchAll(/(?:Mensual|Anticipo(?:\s+1-15)?|Paga\s+extra|Revisi[oó]n\s+salarial)[^\n]{0,80}?(?<!\/)\b(?:0[1-9]|1[0-2])\s*\/\s*\d{2}\b/gi)]
      .map((match) => cleanText(match[0])));
    titles.push(...String(bodyText).split(/\r?\n/).map(cleanText).filter((line) => (
      /\b(?:0[1-9]|1[0-2])\s*\/\s*\d{2}\b/.test(line) && line.length <= 120
    )));
    const visiblePeriods = await frame.locator("body *:visible").evaluateAll((nodes) => nodes
      .filter((node) => /\b(?:0[1-9]|1[0-2])\/\d{2}\b/.test(node.textContent || ""))
      .filter((node) => ![...node.children].some((child) => /\b(?:0[1-9]|1[0-2])\/\d{2}\b/.test(child.textContent || "")))
      .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim())
      .filter((text) => text.length <= 120));
    titles.push(...visiblePeriods);

    const documentButtons = frame.locator('button[title*="Ver el documento" i]:visible, input[title*="Ver el documento" i]:visible');
    const count = await documentButtons.count().catch(() => 0);
    if (count) {
      const rowTitles = await documentButtons.evaluateAll((buttons) => {
        const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
        return buttons.map((button) => {
          const cells = [...(button.closest("tr")?.cells || [])].map((cell) => String(cell.textContent || "").replace(/\s+/g, " ").trim());
          const year = cells.find((cell) => /^20\d{2}$/.test(cell)) || "";
          const monthIndex = cells.findIndex((cell) => months.includes(cell.toLocaleLowerCase("es")));
          const month = monthIndex >= 0 ? months.indexOf(cells[monthIndex].toLocaleLowerCase("es")) + 1 : 0;
          const type = cells.find((cell, index) => index !== monthIndex && cell !== year && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(cell)) || "";
          return year && month && type ? `${type} ${String(month).padStart(2, "0")}/${year.slice(-2)}` : "";
        }).filter(Boolean);
      }).catch(() => []);
      titles.push(...rowTitles);
    }
    for (let index = 0; index < count; index += 1) {
      const title = await documentButtons.nth(index).evaluate((button) => {
        let node = button.parentElement;
        const candidates = [];
        for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
          const text = String(node.innerText || "").replace(/\s+/g, " ").trim();
          if (/\b(?:0[1-9]|1[0-2])\/\d{2}\b/.test(text)) candidates.push(text);
        }
        return candidates.sort((a, b) => a.length - b.length)[0] || "";
      }).catch(() => "");
      if (title) titles.push(title);
    }
  }

  const rows = titles.map((value) => {
    const title = cleanText(value).replace(/^\d+\s*/, "").replace(/\s*Ver el documento\s*$/i, "");
    const rawPeriod = title.match(/(?<!\/)\b((?:0[1-9]|1[0-2])\s*\/\s*\d{2})\b/)?.[1] || "";
    const period = rawPeriod.replace(/\s/g, "");
    const type = cleanText(title.replace(rawPeriod, ""));
    return period && type ? { id: `${period}-${type}`, title, type, period } : null;
  }).filter(Boolean);
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

async function readPayrollDocument(page, button) {
  const context = page.context();
  const responses = [];
  const onResponse = (response) => {
    const contentType = String(response.headers()["content-type"] || "").toLowerCase();
    if (/pdf|octet-stream/.test(contentType) || /\.pdf(?:$|[?#])/i.test(response.url())) responses.push(response);
  };
  context.on("response", onResponse);
  const popupPromise = context.waitForEvent("page", { timeout: 3500 }).catch(() => null);
  const downloadPromise = page.waitForEvent("download", { timeout: 3500 }).catch(() => null);

  let popup = null;
  try {
    await button.click({ noWaitAfter: true, timeout: 10000 });
    [popup] = await Promise.all([popupPromise, downloadPromise.then(() => null)]);
    const download = await downloadPromise;
    if (download) {
      const downloadPath = await download.path();
      if (downloadPath) {
        const bytes = await fs.readFile(downloadPath);
        if (bytes.subarray(0, 4).toString() !== "%PDF") return null;
        return {
          mimeType: "application/pdf",
          contentBase64: bytes.toString("base64")
        };
      }
    }

    if (popup) {
      await popup.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      await popup.waitForTimeout(700);
      const popupUrl = popup.url();
      if (/^https?:/i.test(popupUrl)) {
        const response = await context.request.get(popupUrl, { timeout: 20000 }).catch(() => null);
        if (response?.ok()) {
          const contentType = String(response.headers()["content-type"] || "application/pdf").split(";")[0];
          const bytes = await response.body();
          if (bytes.subarray(0, 4).toString() === "%PDF") {
            return { mimeType: "application/pdf", contentBase64: bytes.toString("base64") };
          }
        }
      }
      const embeddedUrl = await popup.locator("embed[original-url], embed[src], iframe[src], object[data]").first()
        .evaluate((node) => node.getAttribute("original-url") || node.getAttribute("src") || node.getAttribute("data") || "")
        .catch(() => "");
      if (embeddedUrl && !/^(?:blob|chrome-extension):/i.test(embeddedUrl)) {
        const absoluteUrl = new URL(embeddedUrl, popupUrl).href;
        const response = await context.request.get(absoluteUrl, { timeout: 20000 }).catch(() => null);
        if (response?.ok()) {
          const bytes = await response.body();
          if (bytes.subarray(0, 4).toString() === "%PDF") {
            return {
              mimeType: "application/pdf",
              contentBase64: bytes.toString("base64")
            };
          }
        }
      }
    }

    await page.waitForTimeout(500);
    for (const response of responses.reverse()) {
      const bytes = await response.body().catch(() => null);
      if (bytes?.subarray(0, 4).toString() === "%PDF") {
        return {
          mimeType: "application/pdf",
          contentBase64: bytes.toString("base64")
        };
      }
    }
    return null;
  } finally {
    context.off("response", onResponse);
    if (popup && !popup.isClosed()) await popup.close().catch(() => {});
  }
}

async function collectPayrollDocumentFiles(page, rows) {
  const documents = [];
  const storedDocumentIds = await getStoredPayrollDocumentIds();
  for (let index = 0; index < rows.length; index += 1) {
    const payroll = rows[index];
    if (storedDocumentIds.has(payroll.id)) {
      console.log(`Nomina ${payroll.period}: documento ya guardado; se omite la descarga.`);
      continue;
    }
    let file = null;
    for (let attempt = 0; attempt < 2 && !file; attempt += 1) {
      if ((index > 0 || attempt > 0) && !await restoreSecurePayrollList(page)) {
        console.warn(`Nomina ${payroll.period}: no se pudo restaurar la lista segura.`);
        continue;
      }
      const documentControl = await waitForFrameAndLocator(
        page,
        (candidate) => candidate.locator('button[title*="Ver el documento" i]:visible, input[title*="Ver el documento" i]:visible').nth(index),
        5000
      );
      if (!documentControl) {
        console.warn(`Nomina ${payroll.period}: no se encontro el acceso al documento.`);
        continue;
      }
      file = await readPayrollDocument(page, documentControl.locator).catch((error) => {
        console.warn(`Nomina ${payroll.period}: no se pudo descargar. ${error instanceof Error ? error.message : "Error desconocido"}`);
        return null;
      });
      if (!file && attempt === 0) console.warn(`Nomina ${payroll.period}: reintentando el PDF.`);
    }
    if (file?.contentBase64) {
      documents.push({
        documentId: payroll.id,
        title: payroll.title,
        mimeType: file.mimeType || "application/pdf",
        contentBase64: file.contentBase64
      });
      console.log(`Nomina ${payroll.period}: documento disponible (${Math.round(file.contentBase64.length * 0.75 / 1024)} KB).`);
    }
  }
  collectedPayrollDocuments = documents;
  console.log(`Documentos de nomina leidos: ${documents.length}.`);
}

async function getStoredPayrollDocumentIds() {
  if (!supabaseServiceRole) return new Set();
  const channel = portalSnapshotChannel || "main";
  try {
    const response = await fetch(
      `${resolveSupabaseUrl(supabaseUrl)}/rest/v1/app_cpe_portal_documents?select=document_id&channel=eq.${encodeURIComponent(channel)}&chapa=eq.${encodeURIComponent(portalUser)}`,
      {
        headers: {
          apikey: supabaseServiceRole,
          Authorization: `Bearer ${supabaseServiceRole}`
        }
      }
    );
    if (!response.ok) return new Set();
    const rows = await response.json();
    return new Set((rows || []).map((row) => String(row.document_id || "")).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function completePayrollResult(page, result) {
  await collectPayrollDocumentFiles(page, result.rows || []);
  return result;
}

async function restoreSecurePayrollList(page) {
  await openPortalHash(page, "User,Request,,,");
  await openMenu(page, "Consultas", "NÃ³mina electrÃ³nica");
  if ((await extractPayrollRowsFromDom(page)).length) return true;
  const securityControl = await waitForFrameAndLocator(
    page,
    (frame) => frame.getByRole("button", { name: /Validar|Aceptar|Entrar|Abrir modo seguro/i }),
    8000
  );
  if (!securityControl) return false;
  const securityInput = securityControl.frame.locator('input[type="password"]').last();
  if (await securityInput.isVisible().catch(() => false)) {
    await securityInput.fill(portalSecurityKey, { timeout: 10000 });
  }
  await securityControl.locator.click({ noWaitAfter: true });
  await page.waitForTimeout(1200);
  return (await extractPayrollRowsFromDom(page)).length > 0;
}

async function findDoublesSelector(page) {
  return waitForFrameAndLocator(
    page,
    (frame) => frame.locator('input[name="fecha"]:visible, input[id*="fecha" i]:visible'),
    12000
  );
}

async function extractCheckedDoubles(frame, date) {
  const holiday = await frame.locator("body").innerText().then((text) => /D[IÃ]A\s+FESTIVO/i.test(text)).catch(() => false);
  const selections = await frame.locator('input[type="checkbox"]:checked').evaluateAll((checkboxes, isHoliday) => checkboxes.map((input) => {
    const row = input.closest("tr");
    const table = input.closest("table");
    const cell = input.closest("td,th");
    if (!row || !table || !cell) return null;
    const cellIndex = [...row.cells].indexOf(cell);
    const specialty = row.cells[0]?.innerText || "";
    const previousRows = [...table.rows].slice(0, [...table.rows].indexOf(row)).reverse();
    const journey = previousRows
      .map((headerRow) => headerRow.cells[cellIndex]?.innerText?.trim() || "")
      .find((value) => /^\d{2}\s*\/\s*\d{2}$/.test(value)) || "";
    return { specialty, journey, holiday: isHoliday };
  }).filter(Boolean), holiday);
  return buildRequestedDoubles(date, selections);
}

async function collectRequestedDoubles(page) {
  await openPortalHash(page, "User,Request,,,");
  await openMenu(page, "Solicitudes", "Solicitar Dobles por Especialidad");
  let selector = await findDoublesSelector(page);
  if (!selector) throw new Error("No se cargo el selector de Solicitar Dobles.");

  const month = currentMadridMonth();
  const rows = [];
  for (const date of upcomingMadridDates(month)) {
    const { frame, locator: dateInput } = selector;
    const selectorUrl = frame.url();
    await dateInput.fill(date);
    const submit = frame.locator('input[type="submit"][value="Solicitar" i], button:has-text("Solicitar")').first();
    if (!await submit.isVisible().catch(() => false)) {
      throw new Error("No se encontro el boton para consultar los dobles.");
    }
    await Promise.all([
      frame.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => null),
      submit.click({ timeout: 10000 })
    ]);
    await frame.locator("body").waitFor({ state: "visible", timeout: 10000 });
    rows.push(...await extractCheckedDoubles(frame, date));
    await frame.goto(selectorUrl, { waitUntil: "domcontentloaded", timeout: 12000 });
    selector = await findDoublesSelector(page);
    if (!selector) throw new Error(`No se pudo continuar la consulta de dobles tras ${date}.`);
  }

  console.log(`Dobles solicitados leidos: ${rows.length}.`);
  return { recognized: true, month: month.month, year: month.year, monthLabel: month.label, rows };
}

async function collectPayrolls(page) {
  if (!portalSecurityKey) return { recognized: true, locked: true, rows: [] };
  await openPortalHash(page, "User,Request,,,");
  await openMenu(page, "Consultas", "Nómina electrónica");

  const alreadyLoaded = await waitForParsedContent(
    page,
    parsePayrollsHtml,
    (result) => (result.locked ? 0 : 1000) + (result.rows?.length || 0),
    2500,
    (result) => result.recognized && !result.locked && result.rows.length > 0
  );
  if (alreadyLoaded.recognized && !alreadyLoaded.locked && alreadyLoaded.rows.length) {
    console.log(`Nominas leidas: ${alreadyLoaded.rows.length}.`);
    return completePayrollResult(page, alreadyLoaded);
  }

  const alreadyVisibleRows = await extractPayrollRowsFromDom(page);
  if (alreadyVisibleRows.length) {
    console.log(`Nominas leidas: ${alreadyVisibleRows.length}.`);
    return completePayrollResult(page, { recognized: true, locked: false, rows: alreadyVisibleRows });
  }

  let securityControl = await waitForFrameAndLocator(
    page,
    (frame) => frame.getByRole("button", { name: /Validar|Aceptar|Entrar|Abrir modo seguro/i }),
    8000
  );
  if (!securityControl) {
    await openPortalHash(page, "User,Request,,,");
    await openMenu(page, "Consultas", "Nómina electrónica");
    const retryRows = await extractPayrollRowsFromDom(page);
    if (retryRows.length) {
      console.log(`Nominas leidas: ${retryRows.length}.`);
      return completePayrollResult(page, { recognized: true, locked: false, rows: retryRows });
    }
    securityControl = await waitForFrameAndLocator(
      page,
      (frame) => frame.getByRole("button", { name: /Validar|Aceptar|Entrar|Abrir modo seguro/i }),
      8000
    );
  }
  if (!securityControl) throw new Error("No se pudo abrir el modo seguro de Nómina electrónica.");

  const securityInput = securityControl.frame.locator('input[type="password"]').last();
  if (await securityInput.isVisible().catch(() => false)) {
    await securityInput.fill(portalSecurityKey, { timeout: 10000 });
  } else {
    await securityControl.locator.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Control+A");
    await page.keyboard.type(portalSecurityKey);
  }
  await securityControl.locator.click({ noWaitAfter: true });
  await page.waitForTimeout(1200);

  const domRows = await extractPayrollRowsFromDom(page);
  if (domRows.length) {
    console.log(`Nominas leidas: ${domRows.length}.`);
    return completePayrollResult(page, { recognized: true, locked: false, rows: domRows });
  }

  const invalidKey = await waitForFrameAndLocator(
    page,
    (frame) => frame.getByText(/La clave de seguridad es incorrecta/i),
    3000
  );
  if (invalidKey) throw new Error("La clave de seguridad de Nómina electrónica es incorrecta.");

  const accept = await waitForFrameLocator(
    page,
    (frame) => frame.getByRole("button", { name: /Aceptar/i }),
    8000
  );
  if (accept) await accept.click({ noWaitAfter: true });

  const result = await waitForParsedContent(
    page,
    parsePayrollsHtml,
    (parsed) => (parsed.locked ? 0 : 1000) + (parsed.rows?.length || 0),
    12000,
    (parsed) => parsed.recognized && !parsed.locked
  );
  if (result.recognized && !result.locked) {
    console.log(`Nominas leidas: ${result.rows?.length || 0}.`);
    return completePayrollResult(page, result);
  }
  throw new Error("No se pudo leer la lista de Nómina electrónica.");
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

async function collectPrimas(page, previous = null) {
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
    if ((alreadyLoaded.rows || []).some((row) => row.jornal)) {
      return collectPrimasHistory(page, alreadyLoaded, previous);
    }
    const now = new Date();
    const year = Number(process.env.CPE_PORTAL_HISTORY_YEAR || now.getFullYear());
    const month = year === now.getFullYear() ? now.getMonth() + 1 : 12;
    const current = await readPrimasPeriod(
      page.context(),
      "https://portal.cpevalencia.com/Noray/SelDatJorPrimas.asp",
      month,
      year
    );
    return collectPrimasHistory(page, { ...current, locked: false, recognized: true }, previous);
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
  return collectPrimasHistory(page, result, previous);
}

async function collectPrimasHistory(page, currentResult, previous = null) {
  const now = new Date();
  const year = Number(process.env.CPE_PORTAL_HISTORY_YEAR || now.getFullYear());
  const currentMonth = year === now.getFullYear() ? now.getMonth() + 1 : 12;
  const previousHistory = Array.isArray(previous?.history)
    ? previous.history.filter((period) => (
        Number(period?.year) === year
        && Number(period?.month) >= 1
        && Number(period?.month) <= currentMonth
        && Array.isArray(period?.rows)
      ))
    : [];
  const historyByMonth = new Map(previousHistory.map((period) => [Number(period.month), period]));
  const normalizedCurrentLabel = cleanText(currentResult?.monthLabel).toLocaleLowerCase("es");
  const parsedCurrentMonth = MONTH_NAMES_ES.findIndex((monthName) => (
    normalizedCurrentLabel.includes(monthName.toLocaleLowerCase("es"))
  )) + 1;
  if (parsedCurrentMonth > 0 && jornalesPeriodMatches(currentResult?.monthLabel, parsedCurrentMonth, year)) {
    historyByMonth.set(parsedCurrentMonth, {
      year,
      month: parsedCurrentMonth,
      monthLabel: currentResult.monthLabel,
      rows: currentResult.rows || []
    });
  }

  const availableMonths = Array.from({ length: currentMonth }, (_, index) => index + 1);
  const refreshFullHistory = /^(1|true|yes)$/i.test(process.env.CPE_PORTAL_REFRESH_HISTORY || "");
  const monthsToRead = (fastMode ? [] : (refreshFullHistory
    ? availableMonths
    : availableMonths.filter((month) => month === currentMonth || !historyByMonth.has(month))))
    .filter((month) => month !== parsedCurrentMonth);
  const selectorUrl = "https://portal.cpevalencia.com/Noray/SelDatJorPrimas.asp";
  const periodWarnings = [];

  for (const month of monthsToRead) {
    try {
      const period = await readPrimasPeriod(page.context(), selectorUrl, month, year);
      historyByMonth.set(month, period);
      console.log(`Primas ${period.monthLabel}: ${period.rows.length}.`);
    } catch (error) {
      const warning = `${MONTH_NAMES_ES[month - 1]} de ${year}: ${error instanceof Error ? error.message : "lectura fallida"}`;
      periodWarnings.push(warning);
      console.warn(`No se actualizaron las primas de ${warning}`);
    }
  }

  const history = [...historyByMonth.values()].sort((left, right) => Number(left.month) - Number(right.month));
  const current = historyByMonth.get(currentMonth)
    || (Array.isArray(currentResult?.rows) ? currentResult : null)
    || (Array.isArray(previous?.rows) ? previous : null)
    || { monthLabel: "", rows: [] };
  return {
    recognized: true,
    locked: false,
    year,
    monthLabel: current.monthLabel,
    rows: current.rows,
    history,
    historyWarnings: periodWarnings
  };
}

async function upsertSupabase(snapshot) {
  if (!supabaseServiceRole) return;
  const table = portalSnapshotChannel ? "app_cpe_portal_preview_snapshots" : "app_cpe_portal_snapshots";
  const conflict = portalSnapshotChannel ? "channel,chapa" : "chapa";
  const response = await fetch(`${resolveSupabaseUrl(supabaseUrl)}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: "POST",
    headers: {
      "apikey": supabaseServiceRole,
      "Authorization": `Bearer ${supabaseServiceRole}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      ...(portalSnapshotChannel ? { channel: portalSnapshotChannel } : {}),
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

async function upsertPayrollDocuments() {
  if (!supabaseServiceRole || collectedPayrollDocuments.length === 0) return;
  const channel = portalSnapshotChannel || "main";
  for (const document of collectedPayrollDocuments) {
    const response = await fetch(`${resolveSupabaseUrl(supabaseUrl)}/rest/v1/app_cpe_portal_documents?on_conflict=channel,chapa,document_id`, {
      method: "POST",
      headers: {
        apikey: supabaseServiceRole,
        Authorization: `Bearer ${supabaseServiceRole}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        channel,
        chapa: portalUser,
        document_id: document.documentId,
        title: document.title,
        mime_type: document.mimeType,
        content_base64: document.contentBase64,
        updated_at: new Date().toISOString()
      })
    });
    if (!response.ok) {
      throw new Error(`Supabase documento HTTP ${response.status}: ${await response.text()}`);
    }
  }
}

async function getExistingSupabaseSnapshot() {
  if (!supabaseServiceRole || !portalUser) return null;
  try {
    const table = portalSnapshotChannel ? "app_cpe_portal_preview_snapshots" : "app_cpe_portal_snapshots";
    const channelFilter = portalSnapshotChannel ? `&channel=eq.${encodeURIComponent(portalSnapshotChannel)}` : "";
    const response = await fetch(
      `${resolveSupabaseUrl(supabaseUrl)}/rest/v1/${table}?select=payload&chapa=eq.${encodeURIComponent(portalUser)}${channelFilter}&limit=1`,
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
  let latestProgressSnapshot = null;

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
    const hasJournalData = (value) => (
      Array.isArray(value?.rows) && value.rows.length > 0
    ) || (
      Array.isArray(value?.history) && value.history.length > 0
    );
    const hasMonths = (value) => Array.isArray(value?.months) && value.months.length > 0;
    const hasVacationData = (value) => Boolean(value?.recognized);
    const progressPayload = { ...(existingSnapshot?.payload || {}) };
    const publishProgress = async (section, value, stage) => {
      progressPayload[section] = value;
      progressPayload.sync = {
        inProgress: true,
        stage,
        partial: sectionWarnings.length > 0,
        freshSections,
        warnings: [...sectionWarnings]
      };
      latestProgressSnapshot = {
        chapa: portalUser,
        source: PORTAL_URL,
        updatedAt,
        payload: { ...progressPayload }
      };
      await upsertSupabase(latestProgressSnapshot);
    };
    const jornales = await readSection(
      "jornales",
      () => collectJornales(page, existingSnapshot?.payload?.jornales, {
        currentOnly: fastMode
      }),
      existingSnapshot?.payload?.jornales,
      { monthLabel: "", rows: [] },
      hasJournalData
    );
    if (!hasJournalData(jornales)) {
      throw new Error("El portal inicio sesion, pero la consulta de jornales no respondio tras dos intentos. Vuelve a actualizar dentro de unos minutos.");
    }
    await publishProgress("jornales", jornales, "Jornales cargados");
    const mensajes = await readOptionalSection(
      "mensajes",
      () => collectMessages(page),
      existingSnapshot?.payload?.mensajes
        ? { ...existingSnapshot.payload.mensajes, rows: limitRecentPortalRows(existingSnapshot.payload.mensajes.rows, messageLimit) }
        : null,
      { recognized: false, rows: [] },
      hasVacationData
    );
    mensajes.rows = limitRecentPortalRows(mensajes.rows, messageLimit);
    await publishProgress("mensajes", mensajes, "Ultimos mensajes cargados");
    const asignaciones = await readOptionalSection(
      "contratacion actual",
      () => collectAssignments(page, existingSnapshot?.payload?.asignaciones),
      existingSnapshot?.payload?.asignaciones,
      { recognized: false, rows: [] },
      hasVacationData
    );
    await publishProgress("asignaciones", asignaciones, "Contratacion actual cargada");
    const primas = await readOptionalSection(
      "primas",
      () => collectPrimas(page, existingSnapshot?.payload?.primas),
      existingSnapshot?.payload?.primas,
      { locked: true, rows: [] },
      hasRows
    );
    await publishProgress("primas", primas, "Primas cargadas");
    const sl = await readSection(
      "lista SL",
      () => collectSl(page),
      existingSnapshot?.payload?.sl,
      { rows: [] },
      hasRows
    );
    await publishProgress("sl", sl, "Lista SL cargada");
    const descansos = await readSection(
      "descansos",
      () => collectDescansos(page),
      existingSnapshot?.payload?.descansos,
      { worker: { chapa: portalUser, name: "", group: "", currentMonthRest: 0, nextMonthRest: 0 }, months: [], totals: {} },
      hasMonths
    );
    await publishProgress("descansos", descansos, "Descansos cargados");
    const vacaciones = await readOptionalSection(
      "vacaciones",
      () => collectVacaciones(page),
      existingSnapshot?.payload?.vacaciones,
      { recognized: false, year: null, initialMonth: "", totalDays: 0, rows: [] },
      hasVacationData
    );
    await publishProgress("vacaciones", vacaciones, "Vacaciones cargadas");
    const nominas = await readOptionalSection(
      "nomina electronica",
      () => collectPayrolls(page),
      existingSnapshot?.payload?.nominas,
      { recognized: false, locked: !portalSecurityKey, rows: [] },
      hasVacationData
    );
    await publishProgress("nominas", nominas, "Nominas cargadas");
    const dobles = await readOptionalSection(
      "dobles solicitados",
      () => collectRequestedDoubles(page),
      existingSnapshot?.payload?.dobles,
      { recognized: false, month: null, year: null, monthLabel: "", rows: [] },
      hasVacationData
    );
    await publishProgress("dobles", dobles, "Dobles solicitados cargados");
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
      mensajes,
      dobles,
      nominas,
      sync: {
        inProgress: false,
        stage: "Completado",
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
    await upsertPayrollDocuments();
    if (!hasJournalData(jornales) && !hasMonths(descansos) && !hasRows(asignaciones)) {
      throw new Error("El portal inicio sesion, pero no devolvio los datos personales principales (jornales, contratacion ni descansos). La lectura se ha guardado como parcial; vuelve a intentarlo.");
    }
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
      mensajes: payload.mensajes.rows.length,
      dobles: payload.dobles.rows.length,
      nominas: payload.nominas.rows.length,
      partial: payload.sync.partial,
      warnings: payload.sync.warnings
    });
    console.log(`OK: portal oficial sincronizado para ${portalUser}`);
  } catch (error) {
    if (latestProgressSnapshot) {
      latestProgressSnapshot.payload.sync = {
        ...(latestProgressSnapshot.payload.sync || {}),
        inProgress: false,
        stage: "Actualizacion interrumpida",
        partial: true,
        warnings: [
          ...(latestProgressSnapshot.payload.sync?.warnings || []),
          error instanceof Error ? error.message : "Error desconocido"
        ]
      };
      await upsertSupabase(latestProgressSnapshot).catch(() => {});
    }
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Error desconocido");
    process.exit(1);
  });
}
