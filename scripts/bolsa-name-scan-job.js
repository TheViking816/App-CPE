import path from "node:path";
import { chromium } from "playwright";
import {
  assignmentDetailScore,
  isAssignmentDetailComplete,
  parseAssignmentDetailFromTables,
  parseAssignmentsFromTables
} from "./portal-assignments.js";
import {
  mergeNorayJornales,
  mergeNorayLiquidations,
  norayHistoryWindow,
  norayObservation,
  previousMonths,
  sanitizeNorayPartDetail
} from "./noray-jornales.js";
import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const PORTAL_ROOT = "https://portal.cpevalencia.com/#User";
const MOBILE_USER_AGENT = "Mozilla/5.0 (Linux; Android 15; 24040RN64Y) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const supabaseUrl = String(process.env.CPE_SUPABASE_URL || "https://wvwdiywtlbffumshbboa.supabase.co").replace(/\/$/, "");
const serviceRole = resolveSupabaseAdminKey();
const jobId = String(process.env.CPE_BOLSA_SCAN_JOB_ID || "").trim();
const portalUser = String(process.env.CPE_PORTAL_USER || "").replace(/\D/g, "").slice(-5);
const portalPassword = String(process.env.CPE_PORTAL_PASSWORD || "");
const portalSecurityKey = String(process.env.CPE_PORTAL_SECURITY_KEY || "");
const configuredNorayHistoryMonths = String(process.env.CPE_BOLSA_JORNALES_MONTHS || "").trim();
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

async function resolveNorayHistoryMonths() {
  if (configuredNorayHistoryMonths) {
    return norayHistoryWindow(configuredNorayHistoryMonths, false);
  }
  const existing = await request(
    `/rest/v1/app_cpe_noray_jornal_observations?select=source_chapa&source_chapa=eq.${encodeURIComponent(portalUser)}&limit=1`
  );
  return norayHistoryWindow("", Array.isArray(existing) && existing.length > 0);
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

async function waitForNorayJornales(page) {
  await page.goto("https://portal.cpevalencia.com/#User,ViewNoray,3", {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const frame = page.frames().find((candidate) => {
      try {
        const url = new URL(candidate.url());
        return url.hostname === "norayweb.cpevalencia.com" && url.pathname.includes("jornales");
      } catch {
        return false;
      }
    });
    if (frame) {
      const auth = await frame.evaluate(async () => {
        const query = new URLSearchParams(window.location.search.replace(/&amp;/g, "&"));
        const registro = Number(query.get("rec"));
        const username = query.get("usr");
        const password = query.get("pwd");
        if (!(registro > 0) || !username || !password) return null;
        try {
          const response = await fetch("/api/v1/auth/validar-acceso", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usr: username, rec: registro, pwd: password })
          });
          if (!response.ok) return null;
          const data = await response.json();
          return {
            registro,
            localToken: data.local_access_token || null,
            intranetToken: data.intranet_access_token || null,
            intranetAvailable: data.intranet_available
          };
        } catch {
          return null;
        }
      }).catch(() => null);
      if (auth?.intranetAvailable === false) {
        throw new Error("Noray no tiene acceso a la intranet en este momento");
      }
      if (auth?.registro > 0 && auth.localToken && auth.intranetToken && auth.intranetAvailable !== false) {
        return { frame, ...auth };
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error("La nueva pantalla Jornales no quedo disponible");
}

async function norayApi(frame, pathname, { token, method = "GET", body } = {}) {
  const result = await frame.evaluate(async ({ url, authToken, requestMethod, requestBody }) => {
    const response = await fetch(url, {
      method: requestMethod,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      },
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody)
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: response.ok, status: response.status, data };
  }, { url: pathname, authToken: token, requestMethod: method, requestBody: body });
  if (!result.ok) {
    const detail = cleanText(result.data?.detail || result.data?.message || "");
    const error = new Error(`Noray HTTP ${result.status}${detail ? `: ${detail}` : ""}`);
    error.status = result.status;
    throw error;
  }
  return result.data;
}

async function verifyNorayPremiumAccess(frame, localToken) {
  if (!portalSecurityKey) return false;
  try {
    const result = await norayApi(frame, "/api/v1/security-pass/verify", {
      token: localToken,
      method: "POST",
      body: { security_pass: portalSecurityKey }
    });
    return result?.success === true && Boolean(result?.local_access_token);
  } catch (error) {
    if (error?.status === 422 || error?.status === 429) return false;
    throw error;
  }
}

async function readNorayMonth(frame, auth, year, month, premiumsVerified) {
  const base = await norayApi(
    frame,
    `/api/v1/jornales/${auth.registro}/${year}/${month}?incluir_en_curso=false`,
    { token: auth.intranetToken }
  );
  let vigente = null;
  try {
    vigente = await norayApi(frame, `/api/v1/jornales-vigentes/${auth.registro}/${year}/${month}`, {
      token: auth.localToken
    });
  } catch (error) {
    if (![403, 404].includes(error?.status)) throw error;
  }
  let rows = mergeNorayJornales(base?.jornales, vigente?.jornales);
  if (premiumsVerified && year >= 2024) {
    try {
      const current = await norayApi(
        frame,
        `/api/v1/jornales/${auth.registro}/${year}/${month}/liquidacion-en-curso`,
        { token: auth.intranetToken }
      );
      rows = mergeNorayLiquidations(rows, current?.liquidaciones, year);
    } catch (error) {
      if (![403, 404].includes(error?.status)) throw error;
    }
  }
  return rows;
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const result = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await mapper(values[index], index);
    }
  }));
  return result;
}

async function collectNorayHistory(page, historyMonths) {
  const auth = await waitForNorayJornales(page);
  const premiumsVerified = await verifyNorayPremiumAccess(auth.frame, auth.localToken);
  const observedAt = new Date().toISOString();
  const monthRows = [];
  for (const period of previousMonths(historyMonths)) {
    const rows = await readNorayMonth(auth.frame, auth, period.year, period.month, premiumsVerified);
    monthRows.push({ ...period, rows });
  }

  const partKeys = new Map();
  for (const period of monthRows) {
    for (const jornal of period.rows) {
      const parte = String(Number.parseInt(jornal?.parte, 10) || "");
      const year = Number.parseInt(jornal?.anyo, 10) || period.year;
      if (parte) partKeys.set(`${year}:${parte}`, { year, parte, fallback: jornal });
    }
  }
  const details = new Map();
  await mapWithConcurrency([...partKeys.entries()], 4, async ([key, part]) => {
    try {
      const raw = await norayApi(auth.frame, `/api/v1/partes/${part.year}/${part.parte}`, {
        token: auth.intranetToken
      });
      const detail = sanitizeNorayPartDetail(raw, part.fallback);
      if (detail) details.set(key, detail);
    } catch (error) {
      if (![403, 404].includes(error?.status)) throw error;
    }
  });

  const observations = [];
  const workers = new Map();
  for (const period of monthRows) {
    for (const jornal of period.rows) {
      const year = Number.parseInt(jornal?.anyo, 10) || period.year;
      const parte = String(Number.parseInt(jornal?.parte, 10) || "");
      const detail = details.get(`${year}:${parte}`) || null;
      const observation = norayObservation(jornal, detail, {
        sourceChapa: portalUser,
        registro: auth.registro,
        year: period.year,
        month: period.month,
        premiumsVerified,
        observedAt
      });
      if (observation) observations.push(observation);
      for (const specialty of detail?.specialties || []) {
        for (const candidate of specialty.workers || []) {
          const worker = validBolsaWorker(candidate);
          if (!worker) continue;
          const previous = workers.get(worker.chapa);
          if (!previous || worker.nombre.length > previous.nombre.length) workers.set(worker.chapa, worker);
        }
      }
    }
  }
  return {
    observations,
    workers: [...workers.values()],
    partsScanned: details.size,
    premiumsFound: observations.filter((row) => row.premium_amount !== null).length,
    premiumsVerified
  };
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
    else if ((previous.source === "portalestibavlc"
      && cleanText(previous.display_name).localeCompare(cleanText(worker.nombre), "es", { sensitivity: "base" }) !== 0)
      || (previous.source !== "manual" && isBetterName(previous, worker.nombre))) {
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

async function saveNorayObservations(observations) {
  const groups = new Map();
  const now = new Date().toISOString();
  for (const observation of observations) {
    const hasDetail = Array.isArray(observation?.part_detail?.specialties)
      && observation.part_detail.specialties.length > 0;
    const hasPremium = observation?.premium_amount !== null && observation?.premium_status;
    const row = {
      source_chapa: observation.source_chapa,
      source_registro: observation.source_registro,
      year: observation.year,
      month: observation.month,
      fecha: observation.fecha,
      parte: observation.parte,
      jornada: observation.jornada,
      jornada_key: observation.jornada_key,
      source_role: observation.source_role,
      observed_at: observation.observed_at,
      updated_at: now,
      ...(hasDetail ? { part_detail: observation.part_detail } : {}),
      ...(hasPremium ? {
        premium_amount: observation.premium_amount,
        premium_status: observation.premium_status
      } : {})
    };
    const groupKey = `${hasDetail}:${hasPremium}`;
    groups.set(groupKey, [...(groups.get(groupKey) || []), row]);
  }
  for (const rows of groups.values()) {
    for (let index = 0; index < rows.length; index += 200) {
      await request("/rest/v1/app_cpe_noray_jornal_observations?on_conflict=source_chapa,fecha,parte,jornada_key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,missing=default,return=minimal" },
        body: JSON.stringify(rows.slice(index, index + 200))
      });
    }
  }
  return observations.length;
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
    const historyMonths = await resolveNorayHistoryMonths();
    console.log(`[bolsa-scan:${portalUser}] Jornales Noray: ${historyMonths} meses (${configuredNorayHistoryMonths ? "forzado" : historyMonths === 12 ? "carga inicial" : "actualizacion normal"}).`);
    let noray = {
      observations: [], workers: [], partsScanned: 0, premiumsFound: 0,
      premiumsVerified: false, warning: ""
    };
    try {
      noray = { ...noray, ...(await collectNorayHistory(page, historyMonths)) };
      await saveNorayObservations(noray.observations);
    } catch (error) {
      noray.warning = error instanceof Error ? error.message : String(error);
      console.warn(`[bolsa-scan:${portalUser}] Jornales nuevo no disponible: ${noray.warning}`);
    }
    const parts = await listAllParts(page);
    partPage = await context.newPage();
    await partPage.setViewportSize({ width: 412, height: 915 });
    await partPage.setExtraHTTPHeaders({
      "User-Agent": MOBILE_USER_AGENT,
      "Sec-CH-UA-Mobile": "?1",
      "Sec-CH-UA-Platform": '"Android"'
    });
    const found = new Map(noray.workers.map((worker) => [worker.chapa, worker]));
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
    const totalParts = parts.length + noray.partsScanned;
    const premiumMessage = noray.premiumsVerified
      ? `${noray.premiumsFound} primas oficiales observadas`
      : "primas omitidas porque la clave de seguridad no se valido";
    const warningMessage = noray.warning ? `; Jornales nuevo: ${noray.warning}` : "";
    await finish(true, `Leidos ${totalParts} partes; ${saved.newWorkers.length} nombres nuevos, ${saved.updatedWorkers.length} mejorados y ${premiumMessage}${warningMessage}`, {
      partsScanned: totalParts,
      namesFound: workers.length,
      ...saved
    });
    console.log(`SCAN_RESULT ${JSON.stringify({
      chapa: portalUser,
      partsScanned: totalParts,
      norayObservations: noray.observations.length,
      premiumsFound: noray.premiumsFound,
      historyMonths,
      namesFound: workers.length,
      ...saved
    })}`);
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
