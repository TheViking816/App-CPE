import fs from "node:fs/promises";
import { isPremiumCredentialNotice, isExplicitSectionFailure } from "./portal-sync-outcome.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  assignmentDetailScore,
  isAssignmentDetailComplete,
  parseAssignmentDetailFromTables,
  parseAssignmentDetailFromText,
  parseAssignmentsFromTables,
  parseAssignmentsFromText
} from "./portal-assignments.js";
import { parseVacacionesFromRows } from "./portal-vacations.js";
import { buildPortalNotifications } from "./portal-notifications.js";
import { parseExceptions } from "./portal-exceptions.js";
import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";
import { mergeAssignmentsIntoPortalJornales } from "./portal-journal-merge.js";
import { assignmentsFromCurrentJournals } from "./portal-current-assignments.js";
import { normalizePortalPart } from "../src/portalRowIdentity.js";
import { containsAllSavedPortalRows } from "./portal-collection-completeness.js";
import {
  buildRequestedDoubles,
  cleanMessageBodyText,
  extractAddedMessageText,
  isCompleteRequestedDoublesWindow,
  isAuthoritativeEmptyDoublesResult,
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
const supabaseServiceRole = resolveSupabaseAdminKey();
const portalSnapshotChannel = String(process.env.CPE_PORTAL_SNAPSHOT_CHANNEL
  || (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== "main" ? process.env.GITHUB_REF_NAME : "")).trim();
const headless = String(process.env.CPE_PORTAL_HEADLESS || "false").toLowerCase() !== "false";
const profileDir = path.resolve(process.env.CPE_PORTAL_PROFILE_DIR || path.join("data", "portal-oficial-chrome-profile", "shared"));
const browserChannel = String(process.env.CPE_PORTAL_BROWSER_CHANNEL || "bundled").trim();
const portalCdpEndpoint = String(process.env.CPE_PORTAL_CDP_ENDPOINT || "").trim();
const portalCdpContextSlot = String(process.env.CPE_PORTAL_CDP_CONTEXT_SLOT || "").trim();
const MOBILE_PART_USER_AGENT = "Mozilla/5.0 (Linux; Android 15; 24040RN64Y) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const portalClearanceCookies = (() => {
  try {
    const parsed = JSON.parse(process.env.CPE_PORTAL_CLEARANCE_COOKIES || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
})();
const portalRequestKind = String(process.env.CPE_PORTAL_REQUEST_KIND || "snapshot").trim().toLowerCase();
const refreshLatestPayroll = /^(1|true|yes)$/i.test(process.env.CPE_PORTAL_REFRESH_LATEST_PAYROLL || "");
const fastMode = /^(1|true|yes)$/i.test(process.env.CPE_PORTAL_FAST_MODE || "");
const messageLimit = 5;
export const PORTAL_PERIOD_TIMEOUT_MS = 35000;
export const PORTAL_CURRENT_PERIOD_ATTEMPTS = 3;
export const PORTAL_PERIOD_RETRY_DELAY_MS = 1500;
export const PORTAL_ENTRY_TIMEOUT_MS = 90000;
const portalDocumentId = String(process.env.CPE_PORTAL_DOCUMENT_ID || "").trim();
let collectedPayrollDocuments = [];
let authenticatedForPortalUser = false;

export function premiumMonthsToRead({
  currentMonth,
  parsedCurrentMonth,
  fast = false,
  refreshFullHistory = false,
  savedMonths = []
}) {
  const availableMonths = Array.from({ length: currentMonth }, (_, index) => index + 1);
  if (fast) {
    return parsedCurrentMonth === currentMonth ? [] : [currentMonth];
  }
  const saved = new Set(savedMonths.map(Number));
  return (refreshFullHistory
    ? availableMonths
    : availableMonths.filter((month) => month === currentMonth || !saved.has(month)))
    .filter((month) => month !== parsedCurrentMonth);
}

export function pendingPremiumPeriods(history, year, month) {
  const periods = new Map();
  for (const period of history || []) {
    const y = Number(period?.year);
    const m = Number(period?.month);
    if (!Number.isInteger(y) || y < 2000 || !Number.isInteger(m) || m < 1 || m > 12
      || y * 12 + m >= year * 12 + month) continue;
    // An empty production cell can mean a job without a premium, not an unpaid premium.
    const pending = (period.rows || []).some((row) =>
      row.produccionEstado === "pending"
      || (!["verified", "paid"].includes(row.produccionEstado)
        && /[1-9]/.test(String(row.produccion || ""))));
    if (pending) periods.set(`${y}-${m}`, { year: y, month: m });
  }
  return [...periods.values()].sort((a, b) => b.year - a.year || b.month - a.month);
}

export function isPayrollWithinLastMonths(payroll, now = new Date(), monthCount = 12) {
  const match = String(payroll?.period || payroll?.title || "")
    .match(/\b(0[1-9]|1[0-2])\s*\/\s*(\d{2}|\d{4})\b/);
  if (!match || !Number.isInteger(monthCount) || monthCount < 1) return false;

  const payrollMonth = Number(match[1]);
  const payrollYear = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  const madridParts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "numeric"
  }).formatToParts(now);
  const currentYear = Number(madridParts.find((part) => part.type === "year")?.value);
  const currentMonth = Number(madridParts.find((part) => part.type === "month")?.value);
  if (!currentYear || !currentMonth) return false;

  const payrollSerial = payrollYear * 12 + payrollMonth - 1;
  const currentSerial = currentYear * 12 + currentMonth - 1;
  return payrollSerial <= currentSerial && payrollSerial >= currentSerial - (monthCount - 1);
}

export function limitPayrollRowsToLastMonths(rows, now = new Date(), monthCount = 12) {
  return (Array.isArray(rows) ? rows : [])
    .filter((payroll) => isPayrollWithinLastMonths(payroll, now, monthCount));
}

function sanitizePortalError(value) {
  let message = String(value || "Error desconocido");
  for (const secret of [portalPassword, portalSecurityKey]) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  return message;
}

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

function normalizePortalPersonName(value = "") {
  const cleaned = cleanText(value)
    .replace(/^[\s\-:]+/, "")
    .replace(/\s+(?:GRUPO|DESCANSOS|SOLICITUDES|CALENDARIO)\b.*$/i, "")
    .trim();
  const comma = cleaned.match(/^([^,]{2,}),\s*(.{2,})$/);
  return comma ? cleanText(`${comma[2]} ${comma[1]}`) : cleaned;
}

export function parsePortalIdentity(value = "", expectedChapa = portalUser) {
  const chapa = String(expectedChapa || "").replace(/\D/g, "").slice(-5);
  if (!chapa) return { chapa: "", name: "", recognized: false };
  const match = cleanText(value).match(new RegExp(`\\b${chapa}\\b\\s*-\\s*([^|\\n]{3,100}?)(?=\\s+(?:Finalizar\\s+sesi[oó]n|Consultas|Solicitudes)\\b|$)`, "i"));
  const name = normalizePortalPersonName(match?.[1] || "");
  return { chapa, name, recognized: Boolean(name) };
}

export function parseUserSpecialties(html = "") {
  const text = textFromHtml(html);
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const recognized = /(?:MIS\s+)?ESPECIALIDADES|POLIVALENCIAS/.test(normalized)
    && /\b(?:TU|TP)\b/.test(normalized);
  if (!recognized) return { recognized: false, specialties: [], polyvalences: [], ids: [] };

  const taggedIds = [];
  const taggedDefinitions = [
    ["clasificador", "clasificador", /CLASIFICADOR/],
    ["conductor-1a", "pol-conductor-1a", /CONDUCTOR\s+1(?:A|ª)/],
    ["conductor-2a", "pol-conductor-2a", /CONDUCTOR\s+2(?:A|ª)/],
    ["trastainers-rtt", null, /TRASTAINERS?\s+RTT/],
    [null, "pol-especialista", /ESPECIALISTA/],
    [null, "pol-trincador", /TRINCADOR(?:ES)?/],
    [null, "pol-trinca-coches", /TRINCA(?:\s+DE)?\s+COCHES/]
  ];
  for (const [tuId, tpId, pattern] of taggedDefinitions) {
    const match = normalized.match(new RegExp(`${pattern.source}[\\s|:;-]{0,30}\\b(TU|TP)\\b`, "i"));
    const tag = match?.[1];
    const id = tag === "TU" ? tuId : tag === "TP" ? tpId : null;
    if (id) taggedIds.push(id);
  }

  const taggedSpecialties = taggedIds.filter((id) => !id.startsWith("pol-"));
  const taggedPolyvalences = taggedIds.filter((id) => id.startsWith("pol-"));
  return {
    recognized: taggedIds.length > 0,
    specialties: taggedSpecialties,
    polyvalences: taggedPolyvalences,
    ids: [...new Set(taggedIds)]
  };
}

function parseDetailedRowsFromTable(html = "") {
  const rows = [];
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((match) => ({
        html: match[0],
        value: textFromHtml(match[1]).replace(/\|/g, " ").trim()
      }))
      .filter((cell) => cell.value);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function parseProductionVerification(cellHtml = "") {
  const source = String(cellHtml).toLowerCase().replace(/\s+/g, " ");
  if (/\bred\b|#ff0000\b|#f00\b|rgb\(\s*255\s*,\s*0\s*,\s*0\s*\)/i.test(source)) {
    return "pending";
  }
  if (/\bgreen\b|#008000\b|#00ff00\b|#0f0\b|rgb\(\s*0\s*,\s*(?:128|255)\s*,\s*0\s*\)/i.test(source)) {
    return "verified";
  }
  if (/\bblack\b|#000000\b|#000\b|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(source)) {
    return "paid";
  }
  return "unknown";
}

async function contentWithComputedProductionColors(root) {
  await root.evaluate(() => {
    for (const table of document.querySelectorAll("table")) {
      const rows = [...table.querySelectorAll("tr")];
      const headerRowIndex = rows.findIndex((row) => {
        const text = String(row.textContent || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return /Jornal/i.test(text) && /Produccion/i.test(text);
      });
      if (headerRowIndex === -1) continue;

      const headerCells = [...rows[headerRowIndex].querySelectorAll(":scope > th, :scope > td")];
      const productionIndex = headerCells.findIndex((cell) => {
        const text = String(cell.textContent || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return /Produccion/i.test(text);
      });
      if (productionIndex === -1) continue;

      for (const row of rows.slice(headerRowIndex + 1)) {
        const cells = [...row.querySelectorAll(":scope > th, :scope > td")];
        const productionCell = cells[productionIndex];
        if (!productionCell) continue;

        const candidates = [productionCell, ...productionCell.querySelectorAll("*")]
          .filter((element) => String(element.textContent || "").trim());
        const coloredElement = candidates.find((element) => {
          const color = getComputedStyle(element).color;
          return color && color !== "rgb(0, 0, 0)" && color !== "rgba(0, 0, 0, 0)";
        }) || productionCell;
        productionCell.dataset.appCpeComputedColor = getComputedStyle(coloredElement).color;
      }
    }
  }).catch(() => {});

  return root.content().catch(() => "");
}

async function waitForParsedPrimasContent(page, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let bestResult = parsePrimas("");
  let bestScore = 0;

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const result = parsePrimas(await contentWithComputedProductionColors(frame));
      const resultScore = (result.rows || []).filter((row) => row.jornal).length * 1000
        + (result.monthLabel ? 100 : 0);
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

export function restMonthWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "numeric"
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return [{ year, month }, { year: nextYear, month: nextMonth }];
}

export function selectCurrentRestMonths(months, now = new Date()) {
  const requested = restMonthWindow(now);
  const byKey = new Map((Array.isArray(months) ? months : []).map((item) => [
    `${Number(item?.year)}-${Number(item?.month)}`,
    item
  ]));
  return requested
    .map(({ year, month }) => byKey.get(`${year}-${month}`))
    .filter(Boolean);
}

export function hasCurrentRestMonthWindow(value, now = new Date()) {
  return selectCurrentRestMonths(value?.months, now).length === 2;
}

export function parseDescansos(html = "", now = new Date()) {
  const pageText = textFromHtml(html);
  const expectedChapa = String(portalUser || "").replace(/\D/g, "").slice(-5);
  const workerPattern = expectedChapa
    ? new RegExp(`\\b${expectedChapa}\\b\\s*(?:-|:)?\\s*([^|\\n]{3,100})`, "i")
    : /\b([2678]\d{4})\b\s*(?:-|:)?\s*([^|\n]{3,100})/i;
  const workerMatch = pageText.match(workerPattern);
  const worker = {
    chapa: normalizeChapa(expectedChapa || workerMatch?.[1] || ""),
    name: normalizePortalPersonName(workerMatch?.[expectedChapa ? 1 : 2] || ""),
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

  const parsedMonths = [...monthsByKey.values()]
    .map((monthData) => ({
      ...monthData,
      codes: monthData.days.map((day) => day.code).filter(Boolean)
    }))
    .sort((a, b) => (a.year - b.year) || (a.month - b.month));
  // El portal puede dejar el mes anterior en el HTML durante el cambio de
  // mes. App CPE solo debe publicar el mes actual de Madrid y el siguiente.
  const months = selectCurrentRestMonths(parsedMonths, now);

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

export function parsePrimas(html = "") {
  const pageText = textFromHtml(html);
  const detailedRows = parseDetailedRowsFromTable(html);
  const rows = detailedRows.map((row) => row.map((cell) => cell.value));
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
    rows: detailedRows.slice(headerIndex + 1)
      .filter((row) => row.length >= 6 && /^\d+$/.test(String(row[0]?.value || "")))
      .map((detailedRow) => {
        const row = detailedRow.map((cell) => cell.value);
        const productionIndex = indexOf(/producci/, 9);
        return ({
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
          produccion: row[productionIndex] || "",
          produccionEstado: parseProductionVerification(detailedRow[productionIndex]?.html)
        });
      })
  };
}

const protectedCollectionKeys = ["rows", "months", "history", "rules"];

export function wouldEraseStoredCollection(value, fallback, { allowCollectionShrink = false, rowsAreComplete = null } = {}) {
  if (allowCollectionShrink) return false;
  const period = (label) => String(label || "").trim().toLocaleLowerCase("es");
  const nextMonth = period(value?.monthLabel);
  const previousMonth = period(fallback?.monthLabel);
  const differentMonth = value?.recognized && nextMonth && previousMonth && nextMonth !== previousMonth;
  const matchingHistory = differentMonth
    ? fallback?.history?.find((entry) => period(entry?.monthLabel) === nextMonth)
    : null;
  return protectedCollectionKeys.some((key) => {
    const saved = key === "rows" && differentMonth ? matchingHistory?.rows : fallback?.[key];
    if (!Array.isArray(saved) || saved.length < 1) return false;
    const next = value?.[key];
    if (!Array.isArray(next)) return true;
    if (key === "rows" && rowsAreComplete) return !rowsAreComplete(next, saved);
    return next.length < saved.length;
  });
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

async function waitForParsedContent(
  page,
  parser,
  score,
  timeout = 12000,
  isComplete = (_result, resultScore) => resultScore > 0,
  settleMs = 0
) {
  const deadline = Date.now() + timeout;
  let bestResult = parser("");
  let bestScore = score(bestResult);
  let lastImprovementAt = Date.now();

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const result = parser(await frame.content().catch(() => ""));
      const resultScore = score(result);
      if (resultScore > bestScore) {
        bestResult = result;
        bestScore = resultScore;
        lastImprovementAt = Date.now();
      }
    }
    if (isComplete(bestResult, bestScore) && Date.now() - lastImprovementAt >= settleMs) return bestResult;
    await page.waitForTimeout(200);
  }

  return bestResult;
}

async function waitForParsedContext(
  context,
  parser,
  score,
  timeout = 12000,
  isComplete = (_result, resultScore) => resultScore > 0,
  settleMs = 0
) {
  const deadline = Date.now() + timeout;
  let bestResult = parser("");
  let bestScore = score(bestResult);
  let lastImprovementAt = Date.now();

  while (Date.now() < deadline) {
    for (const contextPage of context.pages()) {
      for (const frame of contextPage.frames()) {
        const result = parser(await frame.content().catch(() => ""));
        const resultScore = score(result);
        if (resultScore > bestScore) {
          bestResult = result;
          bestScore = resultScore;
          lastImprovementAt = Date.now();
        }
      }
    }
    if (isComplete(bestResult, bestScore) && Date.now() - lastImprovementAt >= settleMs) return bestResult;
    await new Promise((resolve) => setTimeout(resolve, 200));
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
    20000,
    isAssignmentDetailComplete,
    2500
  );
}

async function readAssignmentDetailViaDesktopWhereAmI(sourcePage, assignment) {
  await sourcePage.goto("https://portal.cpevalencia.com/Noray/DondeVoy.asp", {
    waitUntil: "domcontentloaded",
    timeout: 20000
  });
  const deadline = Date.now() + 20000;
  let best = { recognized: false, specialties: [] };
  let bestScore = 0;
  let lastImprovementAt = Date.now();
  let diagnosticLogged = false;

  while (Date.now() < deadline) {
    for (const frame of sourcePage.frames()) {
      const rows = await frame.locator("tr").evaluateAll((elements) => elements.map((row) => (
        [...row.cells].map((cell) => cell.innerText || "")
      ))).catch(() => []);
      const pageText = await frame.locator("body").innerText().catch(() => "");
      if (!diagnosticLogged && /DondeVoy\.asp/i.test(frame.url()) && rows.length) {
        diagnosticLogged = true;
        console.log(`[parte-dom-rows] ${JSON.stringify(rows.slice(0, 80))}`);
      }
      const parsed = parseAssignmentDetailFromTables([rows], pageText);
      const score = assignmentDetailScore(parsed);
      if (score > bestScore) {
        best = parsed;
        bestScore = score;
        lastImprovementAt = Date.now();
      }
    }
    if (best.recognized
      && String(best.parte || "") === String(assignment.parte || "")
      && Date.now() - lastImprovementAt >= 2500) return best;
    await sourcePage.waitForTimeout(200);
  }
  return best;
}

async function readAssignmentDetailViaMenu(page, assignment) {
  await openPortalHash(page, "User");
  await openMenu(page, "Consultas", "¿Dónde voy? - Orden Servicio");
  const listFrame = await waitForFrame(page, /DondeVoy\.asp/i, 12000);
  const part = String(assignment.parte || "").trim();
  const partCandidates = listFrame.locator("a, button, [role=button], [onclick], td, span")
    .filter({ hasText: part });
  const count = Math.min(await partCandidates.count().catch(() => 0), 40);
  let clicked = false;
  let clickedTarget = null;
  for (let index = 0; index < count; index += 1) {
    const candidate = partCandidates.nth(index);
    const text = cleanText(await candidate.innerText().catch(() => ""));
    if (text !== part || !await candidate.isVisible().catch(() => false)) continue;
    clickedTarget = await candidate.evaluate((node) => {
      const actionable = node.matches("a, button, [role=button], [onclick]") ? node : null
        || node.querySelector?.("a, button, [role=button], [onclick]")
        || node.closest("a, button, [role=button], [onclick]")
        || node.parentElement?.closest("a, button, [role=button], [onclick]")
        || node;
      actionable.click();
      return {
        clicked: true,
        tag: actionable.tagName,
        href: actionable.getAttribute("href"),
        onclick: actionable.getAttribute("onclick"),
        target: actionable.getAttribute("target")
      };
    }).catch(() => null);
    clicked = Boolean(clickedTarget?.clicked);
    if (clicked) break;
  }
  if (!clicked) throw new Error(`No se pudo abrir el parte ${part} desde ¿Dónde voy?.`);
  await page.waitForTimeout(1000);
  const deadline = Date.now() + 20000;
  let best = { recognized: false, specialties: [] };
  let bestScore = 0;
  let lastImprovementAt = Date.now();

  while (Date.now() < deadline) {
    const contextPages = page.context().pages();
    for (const contextPage of contextPages) {
      for (const frame of contextPage.frames()) {
        const rows = await frame.locator("tr").evaluateAll((elements) => elements.map((row) => (
          [...row.cells].map((cell) => cell.innerText || "")
        ))).catch(() => []);
        const pageText = await frame.locator("body").innerText().catch(() => "");
        const parsed = parseAssignmentDetailFromTables([rows], pageText);
        if (String(parsed.parte || "") !== part) continue;
        const score = assignmentDetailScore(parsed);
        if (score > bestScore) {
          best = parsed;
          bestScore = score;
          lastImprovementAt = Date.now();
        }
      }
    }
    if (best.recognized
      && String(best.parte || "") === String(assignment.parte || "")
      && Date.now() - lastImprovementAt >= 2500) return best;
    await page.waitForTimeout(200);
  }
  return best;
}

async function readAssignmentDetailViaContractings(sourcePage, assignment) {
  await sourcePage.goto("https://portal.cpevalencia.com/#User,ViewContractings,,1", {
    waitUntil: "domcontentloaded",
    timeout: 20000
  });
  await sourcePage.waitForTimeout(1200);

  const date = cleanText(assignment?.fecha || "");
  const shortDate = date.replace(/\/(20)?(\d{2})$/, "/$2");
  const journey = cleanText(assignment?.jornada || "")
    .replace(/^DE\s+/i, "")
    .replace(/\s*A\s*/i, "-")
    .replace(/\s*H\.?$/i, "");
  let clicked = false;

  for (const frame of sourcePage.frames()) {
    const candidates = frame.locator("a, button, [role=button], [onclick], div, td, span")
      .filter({ hasText: shortDate });
    const count = Math.min(await candidates.count().catch(() => 0), 120);
    const visible = [];
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      const text = cleanText(await candidate.innerText().catch(() => ""));
      if (!text.includes(shortDate)
        || (journey && !text.replace(/\s+/g, "").includes(journey.replace(/\s+/g, "")))) continue;
      visible.push({ candidate, length: text.length });
    }
    visible.sort((left, right) => left.length - right.length);
    for (const item of visible) {
      clicked = await item.candidate.evaluate((node) => {
        const actionable = node.closest("a, button, [role=button], [onclick]")
          || node.parentElement?.closest("a, button, [role=button], [onclick]")
          || node;
        actionable.click();
        return true;
      }).catch(() => false);
      if (clicked) break;
    }
    if (clicked) break;
  }
  if (!clicked) throw new Error(`No se encontro la tarjeta del parte ${assignment.parte}.`);

  const deadline = Date.now() + 20000;
  let best = parseAssignmentDetailFromText("");
  let bestScore = assignmentDetailScore(best);
  let lastImprovementAt = Date.now();
  while (Date.now() < deadline) {
    for (const frame of sourcePage.frames()) {
      const parsed = parseAssignmentDetailFromText(await frame.locator("body").innerText().catch(() => ""));
      const score = assignmentDetailScore(parsed);
      if (score > bestScore) {
        best = parsed;
        bestScore = score;
        lastImprovementAt = Date.now();
      }
    }
    if (best.recognized
      && String(best.parte || assignment.parte) === String(assignment.parte)
      && Date.now() - lastImprovementAt >= 2500) return best;
    await sourcePage.waitForTimeout(200);
  }
  return best;
}

async function readAssignmentDetailViaHomeCard(sourcePage, assignment) {
  await openPortalHash(sourcePage, "User");
  await sourcePage.waitForTimeout(1200);

  const dateMatch = cleanText(assignment?.fecha || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const dateTokens = dateMatch
    ? [
        `${Number(dateMatch[1])}/${dateMatch[2].padStart(2, "0")}`,
        `${dateMatch[1].padStart(2, "0")}/${dateMatch[2].padStart(2, "0")}`
      ]
    : [];
  let clicked = false;

  for (const frame of sourcePage.frames()) {
    const candidates = frame.locator("a, button, [role=button], [onclick], tr, td, div, span")
      .filter({ hasText: /anticipada/i });
    const count = Math.min(await candidates.count().catch(() => 0), 100);
    const visible = [];
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      const text = cleanText(await candidate.innerText().catch(() => ""));
      if (!/anticipada/i.test(text) || text.length > 220) continue;
      const normalizedText = text.replace(/\s+/g, "");
      const hasExpectedDate = dateTokens.length === 0
        || dateTokens.some((token) => normalizedText.includes(token.replace(/\s+/g, "")));
      if (hasExpectedDate) visible.push({ candidate, length: text.length });
    }
    visible.sort((left, right) => left.length - right.length);
    for (const item of visible) {
      clicked = await item.candidate.evaluate((node) => {
        const actionable = node.closest("a, button, [role=button], [onclick]")
          || node.querySelector?.("a, button, [role=button], [onclick]")
          || node.parentElement?.closest("a, button, [role=button], [onclick], tr")
          || node;
        actionable.click();
        return true;
      }).catch(() => false);
      if (clicked) break;
    }
    if (clicked) break;
  }
  if (!clicked) throw new Error("No se encontro la tarjeta de contratacion anticipada en la portada.");

  const deadline = Date.now() + 20000;
  let best = { recognized: false, specialties: [] };
  let bestScore = 0;
  let lastImprovementAt = Date.now();
  while (Date.now() < deadline) {
    for (const contextPage of sourcePage.context().pages()) {
      for (const frame of contextPage.frames()) {
        const rows = await frame.locator("tr").evaluateAll((elements) => elements.map((row) => (
          [...row.cells].map((cell) => cell.innerText || "")
        ))).catch(() => []);
        const pageText = await frame.locator("body").innerText().catch(() => "");
        const parsed = parseAssignmentDetailFromTables([rows], pageText);
        const score = assignmentDetailScore(parsed);
        if (score > bestScore) {
          best = parsed;
          bestScore = score;
          lastImprovementAt = Date.now();
        }
      }
    }
    if (best.recognized && Date.now() - lastImprovementAt >= 2500) return best;
    await sourcePage.waitForTimeout(200);
  }
  return best;
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

async function waitForPortalEntry(page, timeout = PORTAL_ENTRY_TIMEOUT_MS) {
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

async function logoutExistingPortalSession(page) {
  for (const root of [page, ...page.frames()]) {
    const logoutButton = root.getByRole("button", { name: /Finalizar sesi/i }).first();
    if (await logoutButton.isVisible().catch(() => false)) {
      await logoutButton.click({ timeout: 10000 });
      await page.waitForTimeout(800);
      return true;
    }

    const logoutInput = root.locator('input[value*="Finalizar sesi" i]:visible').first();
    if (await logoutInput.isVisible().catch(() => false)) {
      await logoutInput.click({ timeout: 10000 });
      await page.waitForTimeout(800);
      return true;
    }
  }
  return false;
}

async function login(page, attempt = 0) {
  await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.getByRole("button", { name: "Entendido" }).click({ timeout: 1500 }).catch(() => {});

  let entryState = await waitForPortalEntry(page);
  if (entryState === "authenticated") {
    if (authenticatedForPortalUser) return;
    const loggedOut = await logoutExistingPortalSession(page);
    if (!loggedOut) {
      throw new Error("No se pudo cerrar la sesion anterior del portal de forma segura.");
    }
    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    // A shared worker profile can still contain the session of the previous
    // chapa. The legacy GWT portal often takes considerably longer to rebuild
    // the login iframe after logging that user out. Wait for the new entry
    // state again instead of giving the iframe only the generic 10 seconds.
    entryState = await waitForPortalEntry(page);
  }
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
    if (attempt < 1) return login(page, attempt + 1);
    throw new Error("El portal oficial no ha mostrado el formulario de acceso. Vuelve a intentarlo.");
  }

  const { frame: loginFrame, locator: userInput } = loginForm;
  const passwordInput = loginFrame.locator('input[title*="Contrase"]:visible, input[type="password"]:visible').first();
  const loginButton = loginFrame.getByRole("button", { name: /Iniciar sesi/i }).first();
  await userInput.fill(portalUser, { timeout: 45000 });
  await passwordInput.fill(portalPassword, { timeout: 15000 });
  await loginButton.click({ timeout: 15000 });
  const state = await waitForPortalAuthState(page);
  if (state === "authenticated") {
    authenticatedForPortalUser = true;
    return;
  }
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

async function collectPortalIdentity(page) {
  for (const frame of page.frames()) {
    const identity = parsePortalIdentity(await frame.locator("body").innerText().catch(() => ""), portalUser);
    if (identity.recognized) return identity;
  }
  return { chapa: portalUser, name: "", recognized: false };
}

async function readJornalesPeriod(selectorFrame, selectorUrl, month, year) {
  const expectedLabel = `${MONTH_NAMES_ES[month - 1]} de ${year}`;

  if (await selectorFrame.locator("select").count() < 2) {
    await selectorFrame.goto(selectorUrl, { waitUntil: "domcontentloaded", timeout: PORTAL_PERIOD_TIMEOUT_MS });
  }

  const monthSelect = selectorFrame.locator('select[name="Mes"]');
  const yearSelect = selectorFrame.locator('select[name="Any"]');
  if (await monthSelect.count() === 0 || await yearSelect.count() === 0) {
    throw new Error(`No se encontraron los selectores para ${expectedLabel}.`);
  }

  await monthSelect.selectOption(String(month));
  await yearSelect.selectOption(String(year));
  await Promise.all([
    selectorFrame.waitForNavigation({ waitUntil: "domcontentloaded", timeout: PORTAL_PERIOD_TIMEOUT_MS }).catch(() => null),
    selectorFrame.locator('input[type="submit"]').click({ timeout: 10000 })
  ]);

  const deadline = Date.now() + PORTAL_PERIOD_TIMEOUT_MS;
  let lastHtml = "";
  while (Date.now() < deadline) {
    lastHtml = await selectorFrame.content().catch(() => "");
    const parsed = parseJornales(lastHtml);
    if (parsed.recognized && jornalesPeriodMatches(parsed.monthLabel, month, year)) {
      return {
        year,
        month,
        monthLabel: parsed.monthLabel || expectedLabel,
        rows: Array.isArray(parsed.rows) ? parsed.rows : []
      };
    }
    await selectorFrame.page().waitForTimeout(200);
  }

  const bodyText = cleanText(await selectorFrame.locator("body").innerText().catch(() => ""));
  const responseSample = bodyText.slice(0, 240) || "respuesta vacia";
  const responseRows = await selectorFrame.locator("tr").count().catch(() => 0);
  throw new Error(
    `El portal no devolvio el periodo ${expectedLabel}. Destino: ${safePortalLocation(selectorFrame.url())}. Filas HTML: ${responseRows}. Respuesta: ${responseSample}`
  );
}

async function readPrimasPeriod(context, selectorUrl, month, year) {
  const periodPage = await context.newPage();
  const expectedLabel = `${MONTH_NAMES_ES[month - 1]} de ${year}`;

  try {
    await periodPage.goto(selectorUrl, { waitUntil: "domcontentloaded", timeout: PORTAL_PERIOD_TIMEOUT_MS });
    const selects = periodPage.locator("select");
    if (await selects.count() < 2) {
      throw new Error(`No se encontraron los selectores de primas para ${expectedLabel}.`);
    }

    await selectPortalOption(selects.nth(0), MONTH_NAMES_ES[month - 1]);
    await selectPortalOption(selects.nth(1), String(year));
    const submit = periodPage.locator('input[type="submit"][value*="Aceptar" i], button[type="submit"]:has-text("Aceptar")').first();
    if (!await submit.isVisible().catch(() => false)) {
      throw new Error(`No se encontro el boton para consultar las primas de ${expectedLabel}.`);
    }
    await Promise.all([
      periodPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: PORTAL_PERIOD_TIMEOUT_MS }).catch(() => null),
      submit.click({ timeout: 10000 })
    ]);

    const deadline = Date.now() + PORTAL_PERIOD_TIMEOUT_MS;
    while (Date.now() < deadline) {
      for (const root of [periodPage, ...periodPage.frames()]) {
        const parsed = parsePrimas(await contentWithComputedProductionColors(root));
        if (!parsed.locked && parsed.recognized && jornalesPeriodMatches(parsed.monthLabel, month, year)) {
          return {
            year,
            month,
            monthLabel: parsed.monthLabel || expectedLabel,
            rows: Array.isArray(parsed.rows) ? parsed.rows : []
          };
        }
      }
      await periodPage.waitForTimeout(200);
    }

    const responseSample = cleanText(await periodPage.locator("body").innerText().catch(() => "")).slice(0, 240) || "respuesta vacia";
    throw new Error(
      `El portal no devolvio las primas de ${expectedLabel}. Destino: ${safePortalLocation(periodPage.url())}. Respuesta: ${responseSample}`
    );
  } finally {
    await periodPage.close().catch(() => {});
  }
}

async function collectJornales(page, previous = null, { currentOnly = false, forceMenu = false } = {}) {
  const directSelectorUrl = "https://portal.cpevalencia.com/Noray/SelDatJor1.asp";
  let selectorFrame = null;
  if (!forceMenu) {
    try {
      await page.goto(directSelectorUrl, {
        waitUntil: "domcontentloaded",
        timeout: PORTAL_PERIOD_TIMEOUT_MS
      });
      const monthSelect = page.locator('select[name="Mes"]');
      const yearSelect = page.locator('select[name="Any"]');
      if (await monthSelect.count() > 0 && await yearSelect.count() > 0) {
        selectorFrame = page;
      }
    } catch (error) {
      console.warn(`La ruta directa de jornales no respondio; se usara el menu. ${error instanceof Error ? error.message : ""}`);
    }
  }

  if (!selectorFrame) {
    console.warn(forceMenu
      ? "Reintentando Consulta de jornales desde el menu del portal."
      : "Abriendo Consulta de jornales desde el menu del portal.");
    await openMenu(page, "Consultas", "Consulta de jornales", /SelDatJor1\.asp/i);
    selectorFrame = await waitForFrame(page, /SelDatJor1\.asp/i);
  }
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
  const selectorUrl = selectorFrame.url();
  const periodWarnings = [];
  let freshPeriodCount = 0;

  for (const month of monthsToRead) {
    const attempts = month === currentMonth ? PORTAL_CURRENT_PERIOD_ATTEMPTS : 1;
    let lastError = null;
    let updated = false;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const period = await readJornalesPeriod(selectorFrame, selectorUrl, month, year);
        historyByMonth.set(month, period);
        freshPeriodCount += 1;
        console.log(`Jornales ${period.monthLabel}: ${period.rows.length}${attempt > 1 ? ` (intento ${attempt})` : ""}.`);
        updated = true;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          console.warn(`El mes actual sigue cargando; reintento ${attempt + 1} de ${attempts}...`);
          await page.waitForTimeout(PORTAL_PERIOD_RETRY_DELAY_MS);
        }
      }
    }

    if (!updated) {
      const warning = `${MONTH_NAMES_ES[month - 1]} de ${year}: ${lastError instanceof Error ? lastError.message : "lectura fallida"}`;
      periodWarnings.push(warning);
      console.warn(`No se actualizaron los jornales de ${warning}`);
      if (month === currentMonth && !historyByMonth.has(currentMonth)) {
        throw new Error(`El portal no devolvio los jornales del mes actual tras ${attempts} intentos. ${lastError instanceof Error ? lastError.message : warning}`);
      }
    }
  }

  if (monthsToRead.length > 0 && freshPeriodCount === 0) {
    throw new Error("El portal no actualizo ningun periodo de jornales en este intento.");
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

async function collectJornalesWithFreshSession(page, previous = null, options = {}) {
  try {
    return await collectJornales(page, previous, options);
  } catch (firstError) {
    console.warn(
      `El portal devolvio los jornales vacios; renovando la sesion una sola vez. ${firstError instanceof Error ? firstError.message : ""}`
    );
    await page.context().clearCookies();
    await login(page);
    return collectJornales(page, previous, { ...options, forceMenu: true });
  }
}

async function collectDescansos(page) {
  const directUrl = new URL("/Noray/Prueba.asp", PORTAL_URL);
  directUrl.searchParams.set("f", "1");
  directUrl.searchParams.set("mode", "GWT");
  directUrl.searchParams.set("devType", "Desktop");
  directUrl.searchParams.set("device", "Desktop");
  directUrl.searchParams.set("browser", "Chrome");
  directUrl.searchParams.set("os", "Windows");
  directUrl.searchParams.set("rd", String(Date.now()));
  const directPage = await page.context().newPage();
  try {
    await directPage.goto(directUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
    const directResult = await waitForParsedContent(
      directPage,
      parseDescansos,
      (parsed) => parsed.months?.length || 0,
      20000,
      (parsed) => hasCurrentRestMonthWindow(parsed),
      800
    );
    if (hasCurrentRestMonthWindow(directResult)) return directResult;
  } catch (error) {
    console.warn(`La ruta directa de descansos no respondio; se usara el menu. ${error instanceof Error ? error.message : ""}`);
  } finally {
    await directPage.close().catch(() => {});
  }

  await openMenu(page, "Solicitudes", "Solicitar Descansos");
  const result = await waitForParsedContext(
    page.context(),
    parseDescansos,
    (parsed) => parsed.months?.length || 0,
    30000,
    (parsed) => hasCurrentRestMonthWindow(parsed),
    800
  );
  if (hasCurrentRestMonthWindow(result)) return result;

  throw new Error("El calendario no incluye el mes actual y el siguiente. Se conservaran los ultimos datos disponibles.");
}

async function collectSl(page) {
  await openMenu(page, "Consultas", "Consulta posicion SL", /MostrarSL\.asp/i);
  const parsed = await waitForParsedContent(
    page,
    parseSl,
    (result) => result.recognized ? (result.rows?.length || 0) + 1 : 0,
    10000,
    (result) => result.recognized,
    500
  );
  if (parsed.recognized) return parsed;
  throw new Error("El portal no devolvio una tabla reconocible de Lista SL.");
}

async function collectUserSpecialties(page) {
  await openMenu(page, "Consultas", "Mis especialidades");
  const deadline = Date.now() + 12000;
  do {
    for (const frame of page.frames()) {
      const location = frame.url();
      if (!/\.asp(?:[?#]|$)|especial/i.test(location)) continue;
      const result = parseUserSpecialties(await frame.content().catch(() => ""));
      if (result.recognized && result.ids.length > 0) return result;
    }
    await page.waitForTimeout(200);
  } while (Date.now() < deadline);
  throw new Error("El portal no devolvio las especialidades y polivalencias del usuario.");
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
        const popupPromise = page.context().waitForEvent("page", { timeout: 1500 }).catch(() => null);
        await titles.nth(index).click({ force: true, timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(350);
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
        if (!message.body) {
          const popup = await popupPromise;
          if (popup) {
            await popup.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
            await popup.waitForTimeout(250);
            const popupBody = await popup.locator(".newsText, .newsBody, [class*='newsText'], [class*='newsBody'], [class*='content']").first()
              .innerText()
              .catch(() => popup.locator("body").innerText().catch(() => ""));
            message.body = cleanMessageBodyText(popupBody, { title: message.title });
            await popup.close().catch(() => {});
          }
        }
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

async function collectPayrollDocumentFiles(page, rows, documentId) {
  const documents = [];
  const storedDocumentIds = await getStoredPayrollDocumentIds();
  const targetIndex = documentId ? rows.findIndex((payroll) => payroll.id === documentId) : -1;
  if (documentId && targetIndex < 0) throw new Error("La nomina solicitada ya no aparece en el portal.");
  const targetIndexes = documentId
    ? [targetIndex]
    : rows
        .map((payroll, index) => ({ payroll, index }))
        .filter(({ payroll }) => portalRequestKind !== "history" || isPayrollWithinLastMonths(payroll))
        .map(({ index }) => index);
  if (!documentId && portalRequestKind === "history") {
    console.log(`Nominas limitadas a los ultimos 12 meses: ${targetIndexes.length} documentos.`);
  }
  for (const index of targetIndexes) {
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

async function collectExceptions(page) {
  const readCurrentScreen = async () => {
    const deadline = Date.now() + 12000;
    let bestResult = parseExceptions("");
    let bestScore = 0;
    let recognizedAt = 0;
    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        await frame.locator('input[type="checkbox"]').evaluateAll((inputs) => {
          inputs.forEach((input) => {
            if (input.checked) input.setAttribute("data-app-cpe-checked", "true");
          });
        }).catch(() => {});
        const result = parseExceptions(await frame.content().catch(() => ""));
        const score = (result.recognized ? 1000 : 0) + (result.rows?.length || 0);
        if (score > bestScore) {
          bestResult = result;
          bestScore = score;
          recognizedAt = result.recognized ? Date.now() : 0;
        }
      }
      if (bestResult.recognized && recognizedAt && Date.now() - recognizedAt >= 600) return bestResult;
      await page.waitForTimeout(200);
    }
    return bestResult;
  };

  try {
    await openPortalHash(page, "User,ViewNoray,17");
    const directResult = await readCurrentScreen();
    if (directResult.recognized) return directResult;
  } catch {
    // The menu fallback covers portal route changes and older sessions.
  }

  await openMenu(page, "Solicitudes", "Bolsa de Excepciones");
  const menuResult = await readCurrentScreen();
  if (menuResult.recognized) return menuResult;
  throw new Error("No se pudo leer la Bolsa de Excepciones. Se conservaran los ultimos datos disponibles.");
}

async function getStoredPayrollDocumentIds() {
  if (!supabaseServiceRole) return new Set();
  const channel = portalSnapshotChannel || "main";
  try {
    const response = await fetch(
      `${resolveSupabaseUrl(supabaseUrl)}/rest/v1/app_cpe_portal_documents?select=document_id&channel=eq.${encodeURIComponent(channel)}&chapa=eq.${encodeURIComponent(portalUser)}`,
      {
        headers: supabaseAdminHeaders(supabaseServiceRole)
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
  if (!result.locked && result.rows?.length) {
    if (portalDocumentId || portalRequestKind === "history") {
      await collectPayrollDocumentFiles(page, result.rows, portalDocumentId || "");
      await upsertPayrollDocuments();
    } else if (refreshLatestPayroll) {
      await collectPayrollDocumentFiles(page, result.rows.slice(0, 1), "");
      await upsertPayrollDocuments();
    }
  }
  if (portalRequestKind === "history" && !portalDocumentId && Array.isArray(result?.rows)) {
    return { ...result, rows: limitPayrollRowsToLastMonths(result.rows) };
  }
  return result;
}

function mergePayrollHistory(previous, incoming) {
  if (!incoming?.recognized || incoming?.locked) return previous || incoming;
  const rows = [];
  const seen = new Set();
  for (const payroll of [...(incoming.rows || []), ...(previous?.rows || [])]) {
    const key = String(payroll?.id || payroll?.period || payroll?.title || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(payroll);
  }
  return { ...(previous || {}), ...incoming, rows: limitPayrollRowsToLastMonths(rows) };
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

async function waitForDoublesResult(page, originalFrame, date, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let emptyResultSeenAt = 0;
  while (Date.now() < deadline) {
    const frames = [...new Set([originalFrame, ...page.frames()])];
    for (const frame of frames) {
      if (!frame || frame.isDetached()) continue;
      const matrixSize = await frame.locator('input[type="checkbox"]').count().catch(() => 0);
      if (matrixSize > 0) {
        await frame.waitForTimeout(250);
        return frame;
      }
      const pageText = await frame.locator("body").innerText().catch(() => "");
      if (isAuthoritativeEmptyDoublesResult(pageText)) {
        if (!emptyResultSeenAt) emptyResultSeenAt = Date.now();
        // Give a result matrix time to populate before accepting a genuinely
        // empty day. This avoids mistaking an intermediate paint for zero rows.
        if (Date.now() - emptyResultSeenAt >= 1000) return frame;
      }
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`El portal no termino de cargar los dobles del ${date}.`);
}

async function collectRequestedDoubles(page) {
  await openPortalHash(page, "User,Request,,,");
  await openMenu(page, "Solicitudes", "Solicitar Dobles por Especialidad");
  let selector = await findDoublesSelector(page);
  if (!selector) throw new Error("No se cargo el selector de Solicitar Dobles.");

  const dates = upcomingMadridDates();
  const rows = [];
  const queriedDates = [];
  for (const date of dates) {
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
    const resultFrame = await waitForDoublesResult(page, frame, date);
    rows.push(...await extractCheckedDoubles(resultFrame, date));
    queriedDates.push(date);
    await resultFrame.goto(selectorUrl, { waitUntil: "domcontentloaded", timeout: 12000 });
    selector = await findDoublesSelector(page);
    if (!selector) throw new Error(`No se pudo continuar la consulta de dobles tras ${date}.`);
  }

  console.log(`Dobles solicitados leidos: ${rows.length}.`);
  return {
    recognized: true,
    complete: queriedDates.length === dates.length,
    windowDays: dates.length,
    startDate: dates[0] || null,
    endDate: dates.at(-1) || null,
    queriedDates,
    rows
  };
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
  if (result.recognized && Array.isArray(result.rows)) return result;
  throw new Error("No se pudo leer la contratacion actual. Se conservaran los ultimos datos disponibles.");
}

async function collectAssignmentsViaContractings(page) {
  await openPortalHash(page, "User,ViewContractings,,1");
  let result = await waitForParsedContent(
    page,
    parseAssignments,
    (parsed) => parsed.rows?.length || 0,
    10000
  );
  if (result.recognized && Array.isArray(result.rows)) return result;

  for (const frame of page.frames()) {
    const textResult = parseAssignmentsFromText(await frame.locator("body").innerText().catch(() => ""));
    if (textResult.recognized && textResult.rows.length) {
      console.log(`Jornadas contratadas actuales: ${textResult.rows.length}.`);
      return textResult;
    }
  }

  const contractingsDiagnostic = await Promise.all(page.frames().map(async (frame) => ({
    location: safePortalLocation(frame.url()),
    text: cleanText(await frame.locator("body").innerText().catch(() => "")).slice(0, 700),
    controls: (await frame.locator("a:visible, button:visible, [role=button]:visible").allTextContents().catch(() => []))
      .map((value) => cleanText(value))
      .filter(Boolean)
      .slice(0, 20)
  })));
  console.log(`[contratacion:contractings-diagnostic] ${JSON.stringify(contractingsDiagnostic)}`);

  const today = new Date();
  const todaySerial = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const visibleDates = [];
  for (const frame of page.frames()) {
    const text = await frame.locator("body").innerText().catch(() => "");
    for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g)) {
      const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
      const date = new Date(year, Number(match[2]) - 1, Number(match[1]));
      if (date.getTime() >= todaySerial) visibleDates.push({ label: match[0], time: date.getTime() });
    }
  }
  const targetDates = [...new Map(visibleDates
    .sort((left, right) => right.time - left.time)
    .map((item) => [item.label, item])).values()];

  for (const targetDate of targetDates) {
    let clicked = false;
    for (const frame of page.frames()) {
      const candidates = frame.locator("a, button, [role=button], td, div, span").filter({ hasText: targetDate.label });
      const count = Math.min(await candidates.count().catch(() => 0), 80);
      const visible = [];
      for (let index = 0; index < count; index += 1) {
        const candidate = candidates.nth(index);
        if (!await candidate.isVisible().catch(() => false)) continue;
        const text = cleanText(await candidate.innerText().catch(() => ""));
        if (text.includes(targetDate.label) && text.length <= 180) visible.push({ candidate, length: text.length });
      }
      visible.sort((left, right) => left.length - right.length);
      for (const item of visible) {
        clicked = await item.candidate.evaluate((node) => {
          const actionable = node.closest("a, button, [role=button], [onclick]")
            || node.parentElement?.closest("a, button, [role=button], [onclick]")
            || node;
          actionable.click();
          return true;
        }).catch(() => false);
        if (clicked) break;
      }
      if (clicked) break;
    }
    if (!clicked) continue;
    await page.waitForTimeout(1200);
    result = await waitForParsedContent(
      page,
      parseAssignments,
      (parsed) => parsed.rows?.length || 0,
      10000
    );
    if (result.recognized && result.rows?.length) {
      console.log(`Contratacion ${targetDate.label}: ${result.rows.length} parte(s) leidos desde la tarjeta actual.`);
      return result;
    }
    await openPortalHash(page, "User,ViewContractings,,1");
  }

  const contractedCard = await findVisibleMatchAcrossFrames(page, "div, td, span, a, button", "Jornadas contratadas", 5000);
  if (contractedCard) {
    await contractedCard.click({ timeout: 10000 });
    await page.waitForTimeout(1200);
    result = await waitForParsedContent(
      page,
      parseAssignments,
      (parsed) => parsed.rows?.length || 0,
      10000
    );
  }
  if (result.recognized && Array.isArray(result.rows)) return result;
  throw new Error("La vista actual de Jornadas contratadas no devolvio ninguna contratacion.");
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
  if (result.recognized && Array.isArray(result.rows)) return result;
  throw new Error("No se pudo leer la solicitud de vacaciones. Se conservaran los ultimos datos disponibles.");
}

async function enrichAssignmentsWithDetails(page, result, previousResult) {
  const previousByPart = new Map((previousResult?.rows || [])
    .filter((item) => item.parte && item.detail?.recognized)
    .map((item) => [String(item.parte), item.detail]));
  const rows = [...(result?.rows || [])];
  console.log(`Completando el equipo de ${rows.length} parte(s) desde Jornadas contratadas...`);
  for (let index = 0; index < rows.length; index += 1) {
    const item = rows[index];
    let detail = previousByPart.get(String(item.parte)) || null;
    try {
      let freshDetail;
      if (normalizePortalPart(item.parte) === "CA") {
        try {
          freshDetail = await readAssignmentDetailViaHomeCard(page, item);
        } catch (homeCardError) {
          console.log(`Parte ${item.parte}: la tarjeta de portada no respondio. ${homeCardError instanceof Error ? homeCardError.message : ""}`);
          freshDetail = await readAssignmentDetailViaContractings(page, item);
        }
      } else {
        freshDetail = await readAssignmentDetailViaMenu(page, item);
      }
      console.log(`Parte ${item.parte}: detalle donde-voy=${assignmentDetailScore(freshDetail || {})}/${freshDetail?.specialties?.length || 0}.`);
      if (freshDetail.recognized && assignmentDetailScore(freshDetail) >= assignmentDetailScore(detail || {})) {
        detail = freshDetail;
        console.log(`Parte ${item.parte}: ${freshDetail.specialties.length} especialidades leidas.`);
      } else if (freshDetail.recognized) {
        console.log(`Parte ${item.parte}: la lectura nueva estaba incompleta; se conserva el detalle anterior.`);
      } else {
        console.log(`Parte ${item.parte}: la vista se abrio, pero no contenia un equipo reconocible.`);
      }
    } catch (error) {
      console.log(`Parte ${item.parte}: no se pudo leer el detalle. ${error instanceof Error ? error.message : "Error desconocido"}`);
      // Keep the previous detail when the legacy portal fails to open a part.
    }
    if (detail) rows[index] = { ...item, detail };
  }

  return { ...result, rows };
}

async function collectAssignments(page, previousResult) {
  const result = await collectAssignmentsViaMenu(page);
  console.log(`[contratacion:donde-voy-result] ${JSON.stringify({ recognized: result.recognized, rows: result.rows?.length || 0 })}`);
  return await enrichAssignmentsWithDetails(page, result, previousResult);
}

async function completeAssignmentsFromJournals(page, assignments, journals) {
  const candidates = assignmentsFromCurrentJournals(journals, assignments);
  if (!candidates.length) return assignments;
  const enriched = await enrichAssignmentsWithDetails(
    page,
    { recognized: true, rows: candidates },
    assignments
  );
  return {
    recognized: true,
    rows: [...(assignments?.rows || []), ...(enriched.rows || [])]
  };
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
    if (result.recognized && Array.isArray(result.rows)) return result;
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
    const alreadyLoaded = await waitForParsedPrimasContent(page, 3000);
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
    throw new Error("La clave de seguridad de primas es incorrecta. Revisa los datos de acceso e intentalo de nuevo.");
  }

  const accept = await waitForFrameLocator(
    page,
    (frame) => frame.getByRole("button", { name: /Aceptar/i }),
    8000
  );
  if (accept) {
    await accept.click({ noWaitAfter: true });
  }

  const result = await waitForParsedPrimasContent(page, 15000);
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
        Number(period?.year) >= 2000
        && Number(period?.year) <= year
        && Number(period?.month) >= 1
        && Number(period?.month) <= (Number(period?.year) === year ? currentMonth : 12)
        && Array.isArray(period?.rows)
      ))
    : [];
  const periodKey = (y, m) => `${Number(y)}-${Number(m)}`;
  const historyByMonth = new Map(previousHistory.map((period) => [periodKey(period.year, period.month), period]));
  let loadedMonth = 0;
  const normalizedCurrentLabel = cleanText(currentResult?.monthLabel).toLocaleLowerCase("es");
  const parsedCurrentMonth = MONTH_NAMES_ES.findIndex((monthName) => (
    normalizedCurrentLabel.includes(monthName.toLocaleLowerCase("es"))
  )) + 1;
  if (parsedCurrentMonth > 0 && currentResult?.recognized
    && jornalesPeriodMatches(currentResult?.monthLabel, parsedCurrentMonth, year)
    && containsAllSavedPortalRows(
      currentResult.rows || [],
      historyByMonth.get(periodKey(year, parsedCurrentMonth))?.rows || [],
      { premiumOnly: true }
    )) {
    loadedMonth = parsedCurrentMonth;
    historyByMonth.set(periodKey(year, parsedCurrentMonth), {
      year,
      month: parsedCurrentMonth,
      monthLabel: currentResult.monthLabel,
      rows: currentResult.rows || []
    });
  }

  const refreshFullHistory = /^(1|true|yes)$/i.test(process.env.CPE_PORTAL_REFRESH_HISTORY || "");
  const monthsToRead = premiumMonthsToRead({
    currentMonth,
    parsedCurrentMonth: loadedMonth,
    fast: fastMode,
    refreshFullHistory,
    savedMonths: [...historyByMonth.values()].filter((period) => Number(period.year) === year).map((period) => Number(period.month))
  });
  const periodsToRead = new Map(monthsToRead.map((month) => [periodKey(year, month), { year, month }]));
  for (const period of pendingPremiumPeriods([...historyByMonth.values()], year, currentMonth)) {
    if (period.year === year && period.month === loadedMonth) continue;
    periodsToRead.set(periodKey(period.year, period.month), period);
  }
  const selectorUrl = "https://portal.cpevalencia.com/Noray/SelDatJorPrimas.asp";
  const periodWarnings = [];

  for (const { year: periodYear, month } of periodsToRead.values()) {
    try {
      const period = await readPrimasPeriod(page.context(), selectorUrl, month, periodYear);
      const saved = historyByMonth.get(periodKey(periodYear, month));
      if (!containsAllSavedPortalRows(period.rows, saved?.rows || [], { premiumOnly: true })) {
        throw new Error("Lectura parcial de primas; se conserva el periodo anterior.");
      }
      historyByMonth.set(periodKey(periodYear, month), period);
      console.log(`Primas ${period.monthLabel}: ${period.rows.length}.`);
    } catch (error) {
      const warning = `${MONTH_NAMES_ES[month - 1]} de ${periodYear}: ${error instanceof Error ? error.message : "lectura fallida"}`;
      periodWarnings.push(warning);
      console.warn(`No se actualizaron las primas de ${warning}`);
    }
  }

  const history = [...historyByMonth.values()].sort((left, right) => Number(left.year) - Number(right.year) || Number(left.month) - Number(right.month));
  const current = historyByMonth.get(periodKey(year, currentMonth))
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
    headers: supabaseAdminHeaders(supabaseServiceRole, {
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal"
    }),
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
      headers: supabaseAdminHeaders(supabaseServiceRole, {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      }),
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
        headers: supabaseAdminHeaders(supabaseServiceRole)
      }
    );
    if (!response.ok) return null;
    const rows = await response.json();
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

async function updateUserSpecialtiesFromPortal(userSpecialties) {
  if (!supabaseServiceRole || portalSnapshotChannel || !portalUser) return;
  const body = {};
  if (userSpecialties?.recognized && Array.isArray(userSpecialties.ids) && userSpecialties.ids.length > 0) {
    body.specialties = userSpecialties.ids;
  }
  if (Object.keys(body).length === 0) return;
  const response = await fetch(
    `${resolveSupabaseUrl(supabaseUrl)}/rest/v1/app_cpe_users?chapa=eq.${encodeURIComponent(portalUser)}`,
    {
      method: "PATCH",
      headers: supabaseAdminHeaders(supabaseServiceRole, {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      }),
      body: JSON.stringify(body)
    }
  );
  if (!response.ok) throw new Error(`Supabase perfil HTTP ${response.status}: ${await response.text()}`);
}

async function recordPortalNotifications(previousPayload, nextPayload) {
  if (!supabaseServiceRole || portalSnapshotChannel || !previousPayload || !nextPayload) return;
  const notifications = buildPortalNotifications(previousPayload, nextPayload);
  if (!notifications.length) return;
  const response = await fetch(`${resolveSupabaseUrl(supabaseUrl)}/rest/v1/rpc/app_cpe_record_portal_notifications`, {
    method: "POST",
    headers: supabaseAdminHeaders(supabaseServiceRole, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_chapa: portalUser, p_notifications: notifications })
  });
  if (!response.ok) throw new Error(`Supabase novedades HTTP ${response.status}: ${await response.text()}`);
  const result = await response.json().catch(() => null);
  console.log(`Novedades guardadas: ${Number(result?.inserted || 0)}.`);
}

async function openPortalBrowserSession() {
  if (portalCdpEndpoint) {
    const browser = await chromium.connectOverCDP(portalCdpEndpoint, { timeout: 15000 });
    const markerUrl = portalCdpContextSlot ? `about:blank#app-cpe-slot-${portalCdpContextSlot}` : "";
    const context = markerUrl
      ? browser.contexts().find((candidate) => candidate.pages().some((page) => page.url() === markerUrl))
      : browser.contexts()[0];
    if (!context) throw new Error("Chrome no expone un contexto reutilizable.");
    return {
      context,
      attached: true,
      close: async () => {}
    };
  }

  const launchOptions = {
    headless,
    viewport: { width: 1500, height: 1100 },
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    args: ["--disable-blink-features=AutomationControlled"]
  };
  if (browserChannel && browserChannel !== "bundled") launchOptions.channel = browserChannel;

  const context = await chromium.launchPersistentContext(profileDir, launchOptions);
  if (portalClearanceCookies.length > 0) {
    await context.addCookies(portalClearanceCookies);
  }
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return {
    context,
    attached: false,
    close: () => context.close()
  };
}

async function main() {
  await fs.mkdir(privateDataDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });
  const browserSession = await openPortalBrowserSession();
  const { context } = browserSession;
  const page = context.pages().find((candidate) => candidate.url().startsWith("https://portal.cpevalencia.com"))
    || context.pages()[0]
    || await context.newPage();
  let latestProgressSnapshot = null;

  try {
    const updatedAt = new Date().toISOString();
    if (portalDocumentId) {
      const storedDocumentIds = await getStoredPayrollDocumentIds();
      if (storedDocumentIds.has(portalDocumentId)) {
        await writeStatus({ ok: true, chapa: portalUser, updatedAt, documentId: portalDocumentId, cached: true });
        console.log(`OK: nomina ${portalDocumentId} ya disponible para ${portalUser}`);
        return;
      }
      await login(page);
      let payrolls;
      try {
        payrolls = await collectPayrolls(page);
      } catch (firstError) {
        console.warn(`Reintentando la nomina solicitada. ${firstError instanceof Error ? firstError.message : ""}`);
        await page.waitForTimeout(1000);
        await login(page);
        payrolls = await collectPayrolls(page);
      }
      if (payrolls.locked) throw new Error("Hace falta configurar la clave de seguridad para abrir esta nomina.");
      if (!(payrolls.rows || []).some((payroll) => payroll.id === portalDocumentId)) {
        throw new Error("La nomina solicitada ya no esta disponible en el portal.");
      }
      await upsertPayrollDocuments();
      const refreshedDocumentIds = await getStoredPayrollDocumentIds();
      if (!refreshedDocumentIds.has(portalDocumentId)) {
        throw new Error("El portal no devolvio el PDF de la nomina solicitada.");
      }
      await writeStatus({
        ok: true,
        chapa: portalUser,
        updatedAt,
        documentId: portalDocumentId
      });
      console.log(`OK: nomina ${portalDocumentId} disponible para ${portalUser}`);
      return;
    }
    await login(page);
    const portalIdentity = await collectPortalIdentity(page);
    const existingSnapshot = await getExistingSupabaseSnapshot();
    if (portalRequestKind === "payrolls") {
      const nominas = await collectPayrolls(page);
      const payload = {
        ...(existingSnapshot?.payload || {}),
        nominas,
        sync: {
          inProgress: false,
          stage: "Nominas actualizadas",
          partial: false,
          freshSections: 1,
          warnings: []
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
      await recordPortalNotifications(existingSnapshot?.payload, payload).catch((error) => {
        console.warn(`No se pudieron guardar las novedades. ${error instanceof Error ? error.message : ""}`);
      });
      await writeStatus({
        ok: true,
        chapa: portalUser,
        updatedAt,
        supabaseConfigured: Boolean(supabaseServiceRole),
        nominas: nominas.rows?.length || 0,
        payrollsOnly: true
      });
      console.log(`OK: nominas actualizadas para ${portalUser}`);
      return;
    }
    const sectionWarnings = [];
    const sectionErrors = [];
    const sectionNotices = [];
    let freshSections = 0;
    const readSection = async (name, reader, fallback, emptyValue, isMeaningful, options = {}) => {
      console.log(`Leyendo ${name}...`);
      try {
        const value = await reader();
        if ((!isMeaningful || isMeaningful(value)) && !wouldEraseStoredCollection(value, fallback, options)) {
          sectionErrors.push(...(value?.historyWarnings || []));
          freshSections += 1;
          console.log(`${name} actualizado.`);
          return value;
        }
        const message = `${name} devolvio una respuesta incompleta; se conservan los datos anteriores.`;
        sectionWarnings.push(message);
        console.warn(message);
      } catch (error) {
        const message = `${name} no se pudo actualizar; se conservan los datos anteriores. ${error instanceof Error ? error.message : ""}`.trim();
        sectionErrors.push(message);
        sectionWarnings.push(message);
        console.warn(message);
      }
      return isMeaningful(fallback) ? fallback : emptyValue;
    };
    const readOptionalSection = async (name, reader, fallback, emptyValue, isMeaningful, options = {}) => {
      console.log(`Leyendo ${name}...`);
      try {
        const value = await reader();
        if (value?.locked && !portalSecurityKey && /primas|nomina/.test(name)) {
          sectionNotices.push("Primas y nominas pendientes de introducir la clave de seguridad.");
          return isMeaningful(fallback) ? fallback : emptyValue;
        }
        if (isMeaningful(value) && !wouldEraseStoredCollection(value, fallback, options)) {
          sectionErrors.push(...(value?.historyWarnings || []));
          freshSections += 1;
          console.log(`${name} actualizado.`);
          return value;
        }
        const message = `${name} no devolvio datos; se conserva la ultima lectura disponible.`;
        sectionWarnings.push(message);
        console.warn(message);
      } catch (error) {
        const message = `${name} no se pudo actualizar. ${error instanceof Error ? error.message : ""}`.trim();
        if (isPremiumCredentialNotice(message)) {
          sectionNotices.push("Clave de primas incorrecta: primas y nominas pendientes de actualizar; se conservan los datos guardados.");
          console.warn(message);
          return isMeaningful(fallback) ? fallback : emptyValue;
        }
        if (isExplicitSectionFailure(message)) sectionErrors.push(message);
        sectionWarnings.push(message);
        console.warn(message);
      }
      return isMeaningful(fallback) ? fallback : emptyValue;
    };

    const hasRows = (value) => Array.isArray(value?.rows) && value.rows.length > 0;
    const hasRecognizedSl = (value) => Boolean(value?.recognized) && Array.isArray(value?.rows);
    const hasJournalData = (value) => (
      Boolean(value?.recognized && cleanText(value?.monthLabel))
    ) || (
      Array.isArray(value?.history)
      && value.history.some((period) => cleanText(period?.monthLabel) && Array.isArray(period?.rows))
    );
    const hasPremiumData = (value) => Boolean(
      value?.recognized
      && !value?.locked
      && (
        cleanText(value?.monthLabel)
        || (Array.isArray(value?.history) && value.history.some((period) => (
          cleanText(period?.monthLabel) && Array.isArray(period?.rows)
        )))
      )
    );
    const hasMonths = (value) => Array.isArray(value?.months) && value.months.length > 0;
    const hasVacationData = (value) => Boolean(value?.recognized);
    const hasExceptionData = (value) => Boolean(value?.recognized);
    const progressPayload = { ...(existingSnapshot?.payload || {}) };
    // La bandeja no forma parte de App CPE. Eliminar también cualquier copia
    // antigua mientras se publica el progreso de una nueva sincronización.
    delete progressPayload.mensajes;
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
    await publishProgress("jornales", progressPayload.jornales || { monthLabel: "", rows: [] }, "Sesion iniciada; cargando jornales");
    let jornalesUpdatedThisRun = false;
    let jornales = await readSection(
      "jornales",
      async () => {
        const value = await collectJornalesWithFreshSession(page, existingSnapshot?.payload?.jornales, {
          currentOnly: fastMode
        });
        jornalesUpdatedThisRun = true;
        return value;
      },
      existingSnapshot?.payload?.jornales,
      { monthLabel: "", rows: [] },
      hasJournalData,
      { rowsAreComplete: (nextRows, savedRows) => containsAllSavedPortalRows(nextRows, savedRows) }
    );
    if (!jornalesUpdatedThisRun || !hasJournalData(jornales)) {
      throw new Error("El portal no actualizo los jornales; la sincronizacion no se marcara como completada.");
    }
    await publishProgress("jornales", jornales, hasJournalData(jornales) ? "Jornales cargados" : "Jornales no disponibles; continuando");
    let asignaciones = await readOptionalSection(
      "contratacion actual",
      () => collectAssignments(page, existingSnapshot?.payload?.asignaciones),
      existingSnapshot?.payload?.asignaciones,
      { recognized: false, rows: [] },
      hasVacationData,
      { allowCollectionShrink: true }
    );
    asignaciones = await completeAssignmentsFromJournals(page, asignaciones, jornales);
    await publishProgress("asignaciones", asignaciones, "Contratacion actual cargada");
    jornales = mergeAssignmentsIntoPortalJornales(jornales, asignaciones);
    await publishProgress("jornales", jornales, "Jornales y contratacion consolidados");
    const primas = await readOptionalSection(
      "primas",
      () => collectPrimas(page, existingSnapshot?.payload?.primas),
      existingSnapshot?.payload?.primas,
      { locked: true, rows: [] },
      hasPremiumData,
      { allowCollectionShrink: true }
    );
    await publishProgress("primas", primas, "Primas cargadas");
    const sl = await readSection(
      "lista SL",
      () => collectSl(page),
      existingSnapshot?.payload?.sl,
      { recognized: true, rows: [] },
      hasRecognizedSl,
      { allowCollectionShrink: true }
    );
    await publishProgress("sl", sl, "Lista SL cargada");
    const especialidades = await readOptionalSection(
      "especialidades y polivalencias",
      () => collectUserSpecialties(page),
      existingSnapshot?.payload?.especialidades,
      { recognized: false, specialties: [], polyvalences: [], ids: [] },
      (value) => Boolean(value?.recognized && Array.isArray(value?.ids) && value.ids.length > 0),
      { allowCollectionShrink: true }
    );
    await publishProgress("especialidades", especialidades, "Especialidades y polivalencias cargadas");
    const descansos = await readSection(
      "descansos",
      () => collectDescansos(page),
      existingSnapshot?.payload?.descansos,
      { worker: { chapa: portalUser, name: "", group: "", currentMonthRest: 0, nextMonthRest: 0 }, months: [], totals: {} },
      hasMonths
    );
    if (portalIdentity.recognized && !cleanText(descansos?.worker?.name)) {
      descansos.worker = {
        ...(descansos.worker || {}),
        chapa: portalIdentity.chapa,
        name: portalIdentity.name
      };
    }
    await publishProgress("descansos", descansos, "Descansos cargados");
    const excepciones = await readOptionalSection(
      "bolsa de excepciones",
      () => collectExceptions(page),
      existingSnapshot?.payload?.excepciones,
      { recognized: false, year: new Date().getFullYear(), maxAnnual: 15, usedTotal: 0, remaining: 15, rows: [], rules: [] },
      hasExceptionData,
      { allowCollectionShrink: true }
    );
    await publishProgress("excepciones", excepciones, "Excepciones cargadas");
    const vacaciones = await readOptionalSection(
      "vacaciones",
      () => collectVacaciones(page),
      existingSnapshot?.payload?.vacaciones,
      { recognized: false, year: null, initialMonth: "", totalDays: 0, rows: [] },
      hasVacationData,
      { allowCollectionShrink: true }
    );
    await publishProgress("vacaciones", vacaciones, "Vacaciones cargadas");
    const nominas = portalRequestKind === "history"
      ? await readOptionalSection(
          "nominas y documentos",
          () => collectPayrolls(page),
          existingSnapshot?.payload?.nominas,
          { recognized: false, locked: !portalSecurityKey, rows: [] },
          (value) => Boolean(value?.recognized && !value?.locked)
        )
      : refreshLatestPayroll
        ? mergePayrollHistory(
            existingSnapshot?.payload?.nominas,
            await readOptionalSection(
              "ultima nomina",
              () => collectPayrolls(page),
              existingSnapshot?.payload?.nominas,
              { recognized: false, locked: !portalSecurityKey, rows: [] },
              (value) => Boolean(value?.recognized && !value?.locked)
            )
          )
      : existingSnapshot?.payload?.nominas
        || { recognized: false, locked: !portalSecurityKey, rows: [] };
    if (portalRequestKind === "history" || refreshLatestPayroll) {
      await publishProgress(
        "nominas",
        nominas,
        portalRequestKind === "history" ? "Nominas de los ultimos 12 meses guardadas" : "Ultima nomina actualizada"
      );
    }
    const dobles = await readOptionalSection(
      "dobles solicitados",
      () => collectRequestedDoubles(page),
      existingSnapshot?.payload?.dobles,
      { recognized: false, month: null, year: null, monthLabel: "", rows: [] },
      isCompleteRequestedDoublesWindow,
      { allowCollectionShrink: true }
    );
    await publishProgress("dobles", dobles, "Dobles solicitados cargados");
    if (freshSections === 0) {
      throw new Error("El portal no devolvio ninguna seccion util. Se conservaran los datos anteriores.");
    }

    const payload = {
      jornales,
      asignaciones,
      descansos,
      especialidades,
      excepciones,
      sl,
      primas,
      vacaciones,
      dobles,
      nominas,
      sync: {
        inProgress: false,
        stage: "Completado",
        partial: sectionWarnings.length > 0,
        freshSections,
        warnings: sectionWarnings,
        notices: [...new Set(sectionNotices)],
        errors: [...sectionErrors],
        ...(portalRequestKind === "history"
          && sectionNotices.length === 0
          && sectionWarnings.length === 0
          && hasJournalData(jornales)
          && hasPremiumData(primas)
          && nominas?.recognized
          && !nominas?.locked
          ? { fullHistoryCompletedAt: updatedAt }
          : existingSnapshot?.payload?.sync?.fullHistoryCompletedAt
            ? { fullHistoryCompletedAt: existingSnapshot.payload.sync.fullHistoryCompletedAt }
            : {})
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
    await updateUserSpecialtiesFromPortal(especialidades).catch((error) => {
      console.warn(`No se pudieron actualizar las especialidades del perfil. ${error instanceof Error ? error.message : ""}`);
    });
    await recordPortalNotifications(existingSnapshot?.payload, payload).catch((error) => {
      console.warn(`No se pudieron guardar las novedades. ${error instanceof Error ? error.message : ""}`);
    });
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
      excepciones: payload.excepciones.rows.length,
      vacaciones: payload.vacaciones.rows.length,
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
          sanitizePortalError(error instanceof Error ? error.message : "Error desconocido")
        ]
      };
      await upsertSupabase(latestProgressSnapshot).catch(() => {});
    }
    await writeStatus({
      ok: false,
      chapa: portalUser || null,
      updatedAt: new Date().toISOString(),
      message: sanitizePortalError(error instanceof Error ? error.message : "Error desconocido")
    });
    throw error;
  } finally {
    await browserSession.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(sanitizePortalError(error instanceof Error ? error.message : "Error desconocido"));
      process.exit(1);
    });
}
