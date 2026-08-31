import path from "node:path";
import { chromium } from "playwright";
import {
  assignmentDetailScore,
  isAssignmentDetailComplete,
  parseAssignmentDetailFromTables,
  parseAssignmentsFromTables
} from "./portal-assignments.js";
import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const PORTAL_ROOT = "https://portal.cpevalencia.com/#User";
const MOBILE_USER_AGENT = "Mozilla/5.0 (Linux; Android 15; 24040RN64Y) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const supabaseUrl = String(process.env.CPE_SUPABASE_URL || "https://wvwdiywtlbffumshbboa.supabase.co").replace(/\/$/, "");
const serviceRole = resolveSupabaseAdminKey();
const jobId = String(process.env.CPE_BOLSA_SCAN_JOB_ID || "").trim();
const portalUser = String(process.env.CPE_PORTAL_USER || "").replace(/\D/g, "").slice(-5);
const portalPassword = String(process.env.CPE_PORTAL_PASSWORD || "");
const clearanceCookies = (() => {
  try {
    const value = JSON.parse(process.env.CPE_PORTAL_CLEARANCE_COOKIES || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
})();

function request(pathname, options = {}) {
  return fetch(`${supabaseUrl}${pathname}`, {
    ...options,
    headers: supabaseAdminHeaders(serviceRole, {
      "Content-Type": "application/json",
      ...(options.headers || {})
    })
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${await response.text()}`);
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  });
}

function cleanText(value = "") {
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function validBolsaWorker(worker) {
  const code = String(worker?.code || "").replace(/\D/g, "");
  const name = cleanText(worker?.name);
  if (!/^80\d{3}$/.test(code) || name.length < 2) return null;
  if (/^(?:CERO|PERSONAL DE BOLSA|SIN NOMBRE(?: PUBLICADO)?|CARGANDO)$/i.test(name)) return null;
  return { chapa: code, nombre: name };
}

function extractBolsaWorkersFromText(pageText = "") {
  const found = new Map();
  for (const rawLine of String(pageText).split(/\r?\n/)) {
    const line = cleanText(rawLine);
    const match = line.match(/^(80\d{3})\s+(.+)$/);
    if (!match) continue;
    const worker = validBolsaWorker({ code: match[1], name: match[2] });
    if (worker) found.set(worker.chapa, worker);
  }
  return [...found.values()];
}

async function extractTables(page) {
  const tables = [];
  const texts = [];
  for (const frame of page.frames()) {
    texts.push(await frame.locator("body").innerText().catch(() => ""));
    const frameTables = await frame.locator("table").evaluateAll((nodes) => nodes.map((table) => (
      [...table.querySelectorAll("tr")].map((row) => (
        [...row.querySelectorAll(":scope > th, :scope > td")]
          .map((cell) => String(cell.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
      )).filter((row) => row.length)
    ))).catch(() => []);
    tables.push(...frameTables);
  }
  return { tables, pageText: texts.join("\n") };
}

async function portalState(page) {
  const contents = await Promise.all(page.frames().map((frame) => frame.locator("body").innerText().catch(() => "")));
  const text = contents.join("\n");
  if (/Verificaci[oó]n de seguridad|Just a moment|Ray ID/i.test(text)) return "challenge";
  if (/Finalizar sesi[oó]n/i.test(text)) return "authenticated";
  if (/Iniciar sesi[oó]n/i.test(text)) return "login";
  return "pending";
}

async function waitForState(page, accepted, timeout = 45000) {
  const deadline = Date.now() + timeout;
  let state = "pending";
  while (Date.now() < deadline) {
    state = await portalState(page);
    if (accepted.includes(state)) return state;
    await page.waitForTimeout(250);
  }
  return state;
}

async function login(page) {
  await page.goto(PORTAL_ROOT, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.getByRole("button", { name: "Entendido" }).click({ timeout: 1200 }).catch(() => {});
  let state = await waitForState(page, ["authenticated", "login", "challenge"], 90000);
  if (state === "challenge") throw new Error("Cloudflare requiere verificacion antes de continuar");
  if (state === "authenticated") {
    let loggedOut = false;
    for (const frame of page.frames()) {
      const button = frame.getByRole("button", { name: /Finalizar sesi/i }).first();
      const input = frame.locator('input[value*="Finalizar sesi" i]:visible').first();
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: 10000 });
        loggedOut = true;
        break;
      }
      if (await input.isVisible().catch(() => false)) {
        await input.click({ timeout: 10000 });
        loggedOut = true;
        break;
      }
    }
    if (!loggedOut) throw new Error("No se pudo cerrar la sesion anterior del gateway");
    await page.goto(PORTAL_ROOT, { waitUntil: "domcontentloaded", timeout: 45000 });
    state = await waitForState(page, ["login", "challenge"], 90000);
  }

  let form = null;
  const deadline = Date.now() + 15000;
  while (!form && Date.now() < deadline) {
    for (const frame of page.frames()) {
      const user = frame.locator('input[title="Usuario"]:visible, input[type="text"]:visible').first();
      if (await user.isVisible().catch(() => false)) {
        form = { frame, user };
        break;
      }
    }
    if (!form) await page.waitForTimeout(250);
  }
  if (!form) throw new Error("El portal no mostro el formulario de acceso");
  await form.user.fill(portalUser);
  await form.frame.locator('input[title*="Contrase"]:visible, input[type="password"]:visible').first().fill(portalPassword);
  await form.frame.getByRole("button", { name: /Iniciar sesi/i }).first().click();
  state = await waitForState(page, ["authenticated", "challenge"], 30000);
  if (state !== "authenticated") throw new Error(state === "challenge" ? "Cloudflare bloqueo el acceso" : "El portal no confirmo la sesion");
}

async function openContractings(page) {
  await page.goto("https://portal.cpevalencia.com/#User,ViewContractings,,1", {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForTimeout(1500);

  const initial = await extractTables(page);
  if (parseAssignmentsFromTables(initial.tables, initial.pageText).rows.length) return;
  for (const frame of page.frames()) {
    const card = frame.getByText(/Jornadas contratadas/i).first();
    if (await card.isVisible().catch(() => false)) {
      await card.click({ timeout: 10000 });
      await page.waitForTimeout(1200);
      return;
    }
  }
}

async function currentAssignmentParts(page) {
  const { tables, pageText } = await extractTables(page);
  const parsed = parseAssignmentsFromTables(tables, pageText);
  const detailSnapshot = parseAssignmentDetailFromTables(tables, pageText);
  const workersSnapshot = extractBolsaWorkersFromText(pageText);
  const parts = new Map();
  for (const row of parsed.rows || []) {
    if (/^\d+$/.test(String(row.parte || ""))) parts.set(String(row.parte), row);
  }
  for (const frame of page.frames()) {
    const hrefs = await frame.locator('a[href*="parte=" i]').evaluateAll((links) => links.map((link) => link.getAttribute("href") || link.href)).catch(() => []);
    for (const href of hrefs) {
      const parte = String(href).match(/[?&]parte=(\d+)/i)?.[1];
      if (/^\d+$/.test(parte || "")) {
        parts.set(parte, {
          ...(parts.get(parte) || {}),
          parte,
          detailUrl: href,
          detailSnapshot: detailSnapshot.recognized ? detailSnapshot : null,
          workersSnapshot
        });
      }
    }
  }
  return [...parts.values()];
}

async function findNextControl(page) {
  for (const frame of page.frames()) {
    const mobileRight = frame.locator('img[src*="mobile/right.gif" i]').first();
    if (await mobileRight.isVisible().catch(() => false)) {
      const parentButton = mobileRight.locator("xpath=ancestor::button[1]");
      if (await parentButton.count()) return parentButton;
    }
    const candidates = frame.locator('button:visible, input[type="button"]:visible, input[type="image"]:visible, a:visible');
    const metadata = await candidates.evaluateAll((nodes) => nodes.map((node) => ({
      label: [node.textContent, node.getAttribute("value"), node.getAttribute("title"), node.getAttribute("alt"), node.getAttribute("aria-label"), node.getAttribute("src")].filter(Boolean).join(" "),
      disabled: Boolean(node.disabled) || node.getAttribute("aria-disabled") === "true"
    }))).catch(() => []);
    const index = metadata.findIndex((item) => !item.disabled && /(?:siguiente|next|derecha|right|adelante|(?:^|\s)>\s*$)/i.test(item.label));
    if (index >= 0) return candidates.nth(index);
  }
  return null;
}

async function listAllParts(page) {
  await openContractings(page);
  const parts = new Map();
  let previousSignature = "";
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    await page.waitForTimeout(600);
    const current = await currentAssignmentParts(page);
    current.forEach((item) => parts.set(String(item.parte), item));
    const signature = current.map((item) => item.parte).sort().join(",");
    const next = await findNextControl(page);
    if (!next || !signature || signature === previousSignature) break;
    previousSignature = signature;
    await next.click({ timeout: 8000 }).catch(() => {});
  }
  return [...parts.values()];
}

async function readPart(page, assignment) {
  if (assignment.workersSnapshot) {
    return { recognized: true, specialties: [{ name: "BOLSA", workers: assignment.workersSnapshot.map((worker) => ({ code: worker.chapa, name: worker.nombre })) }] };
  }
  if (assignment.detailSnapshot?.recognized) return assignment.detailSnapshot;
  const year = String(assignment.fecha || "").match(/\b(20\d{2})\b/)?.[1] || String(new Date().getFullYear());
  const url = assignment.detailUrl || `https://portal.cpevalencia.com/Noray/ParteA.asp?anyo=${year}&parte=${encodeURIComponent(assignment.parte)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const deadline = Date.now() + 18000;
  let best = { recognized: false, specialties: [] };
  while (Date.now() < deadline) {
    const { tables, pageText } = await extractTables(page);
    const parsed = parseAssignmentDetailFromTables(tables, pageText);
    if (assignmentDetailScore(parsed) > assignmentDetailScore(best)) best = parsed;
    if (isAssignmentDetailComplete(best)) break;
    await page.waitForTimeout(300);
  }
  return best;
}

function isBetterName(current, candidate) {
  if (!current) return true;
  const oldName = cleanText(current.display_name);
  const newName = cleanText(candidate);
  if (oldName.localeCompare(newName, "es", { sensitivity: "base" }) === 0) return false;
  const oldWords = oldName.split(/\s+/).length;
  const newWords = newName.split(/\s+/).length;
  return newWords > oldWords || (newWords === oldWords && newName.length > oldName.length + 2);
}

async function saveWorkers(found) {
  const stored = await request("/rest/v1/app_cpe_bolsa_worker_directory?select=bolsa_chapa,display_name,source");
  const byChapa = new Map((stored || []).map((row) => [row.bolsa_chapa, row]));
  const newWorkers = [];
  const updatedWorkers = [];
  for (const worker of found) {
    const previous = byChapa.get(worker.chapa);
    if (!previous) newWorkers.push(worker);
    else if (previous.source !== "manual" && isBetterName(previous, worker.nombre)) {
      updatedWorkers.push({ ...worker, anterior: previous.display_name });
    }
  }

  const now = new Date().toISOString();
  const rows = [...newWorkers, ...updatedWorkers].map((worker) => ({
    bolsa_chapa: worker.chapa,
    display_name: worker.nombre,
    source: "app_cpe",
    first_seen_at: now,
    last_seen_at: now,
    updated_at: now
  }));
  if (rows.length) {
    await request("/rest/v1/app_cpe_bolsa_worker_directory?on_conflict=bolsa_chapa", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows)
    });
  }
  return { newWorkers, updatedWorkers };
}

async function finish(ok, message, metrics = {}) {
  return request("/rest/v1/rpc/app_cpe_finish_bolsa_name_scan_job", {
    method: "POST",
    body: JSON.stringify({
      p_id: jobId,
      p_ok: ok,
      p_message: message,
      p_parts_scanned: metrics.partsScanned || 0,
      p_names_found: metrics.namesFound || 0,
      p_new_workers: metrics.newWorkers || [],
      p_updated_workers: metrics.updatedWorkers || []
    })
  });
}

async function main() {
  if (!serviceRole || !jobId || !portalUser || !portalPassword) throw new Error("Faltan datos para ejecutar el rastreo aislado");
  const profileDir = path.resolve(process.env.CPE_BOLSA_SCAN_PROFILE_DIR || path.join("data", "portal-bolsa-name-scan-profiles", portalUser));
  const launchOptions = {
    headless: /^(1|true|yes)$/i.test(process.env.CPE_PORTAL_HEADLESS || "false"),
    viewport: { width: 1500, height: 1100 },
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    args: ["--disable-blink-features=AutomationControlled"]
  };
  const browserChannel = String(process.env.CPE_PORTAL_BROWSER_CHANNEL || "chrome").trim();
  if (browserChannel && browserChannel !== "bundled") launchOptions.channel = browserChannel;
  const useGatewayContext = /^(1|true|yes)$/i.test(process.env.CPE_BOLSA_SCAN_USE_GATEWAY_CONTEXT || "");
  let attachedBrowser = null;
  let context;
  if (useGatewayContext) {
    const endpoint = String(process.env.CPE_PORTAL_CDP_ENDPOINT || "http://127.0.0.1:9223");
    attachedBrowser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
    context = attachedBrowser.contexts()[0];
    if (!context) throw new Error("Chrome gateway no expone un contexto reutilizable");
  } else {
    context = await chromium.launchPersistentContext(profileDir, launchOptions);
    if (clearanceCookies.length) await context.addCookies(clearanceCookies);
    await context.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
  }
  const page = context.pages().find((candidate) => candidate.url().startsWith("https://portal.cpevalencia.com")) || await context.newPage();
  let partPage = null;
  try {
    await login(page);
    const parts = await listAllParts(page);
    partPage = await context.newPage();
    await partPage.setViewportSize({ width: 412, height: 915 });
    await partPage.setExtraHTTPHeaders({
      "User-Agent": MOBILE_USER_AGENT,
      "Sec-CH-UA-Mobile": "?1",
      "Sec-CH-UA-Platform": '"Android"'
    });
    const found = new Map();
    for (const assignment of parts) {
      const detail = await readPart(partPage, assignment);
      for (const specialty of detail.specialties || []) {
        for (const candidate of specialty.workers || []) {
          const worker = validBolsaWorker(candidate);
          if (!worker) continue;
          const previous = found.get(worker.chapa);
          if (!previous || worker.nombre.length > previous.nombre.length) found.set(worker.chapa, worker);
        }
      }
    }
    const workers = [...found.values()].sort((a, b) => a.chapa.localeCompare(b.chapa));
    const saved = await saveWorkers(workers);
    await finish(true, `Leidos ${parts.length} partes; ${saved.newWorkers.length} nombres nuevos y ${saved.updatedWorkers.length} mejorados`, {
      partsScanned: parts.length,
      namesFound: workers.length,
      ...saved
    });
    console.log(`SCAN_RESULT ${JSON.stringify({ chapa: portalUser, partsScanned: parts.length, namesFound: workers.length, ...saved })}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finish(false, message).catch(() => {});
    throw error;
  } finally {
    await partPage?.close().catch(() => {});
    if (!useGatewayContext) await context.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`[bolsa-scan:${portalUser}] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
);
