import path from "node:path";
import { chromium } from "playwright";
import {
  assignmentDetailScore,
  isAssignmentDetailComplete,
  parseAssignmentDetailFromText
} from "./portal-assignments.js";
import {
  mergeNorayJornales,
  mergeNorayLiquidations,
  norayHistoryWindow,
  norayObservation,
  previousMonths,
  recentCompletedNorayParts,
  sanitizeNorayPartDetail
} from "./noray-jornales.js";
import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const PORTAL_ROOT = "https://portal.cpevalencia.com/#User";
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
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/^\s*(?:bsa|nbs|dbs)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveNorayHistoryMonths() {
  if (configuredNorayHistoryMonths) {
    return norayHistoryWindow(configuredNorayHistoryMonths, false);
  }
  return 2;
}

function validBolsaWorker(worker) {
  const code = String(worker?.code || "").replace(/\D/g, "");
  const name = cleanText(worker?.name);
  if (!/^80\d{3}$/.test(code) || name.length < 2) return null;
  if (/^(?:CERO|PERSONAL DE BOLSA|SIN NOMBRE(?: PUBLICADO)?|CARGANDO)$/i.test(name)) return null;
  return { chapa: code, nombre: name };
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
  await page.goto("https://portal.cpevalencia.com/#User,ViewNoray,2", {
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

async function readOpenedNorayPart(page, expectedPart) {
  const deadline = Date.now() + 4000;
  let best = { recognized: false, specialties: [] };
  let bestScore = 0;
  let lastImprovementAt = Date.now();
  while (Date.now() < deadline) {
    const texts = await Promise.all(page.frames().map((frame) => frame.locator("body").innerText().catch(() => "")));
    const parsed = parseAssignmentDetailFromText(texts.join("\n"));
    const score = assignmentDetailScore(parsed);
    if (String(parsed.parte || "") === String(expectedPart) && score > bestScore) {
      best = parsed;
      bestScore = score;
      lastImprovementAt = Date.now();
    }
    if (isAssignmentDetailComplete(best) && Date.now() - lastImprovementAt >= 600) return best;
    await page.waitForTimeout(200);
  }
  return best;
}

async function closeNorayPartModal(page, frame, part) {
  await page.keyboard.press("Escape").catch(() => {});
  const closeSelectors = [
    '[aria-label*="cerrar" i]:visible',
    '[title*="cerrar" i]:visible',
    'button:has(svg[class*="x" i]):visible',
    '[role="dialog"] button:visible'
  ];
  let clicked = false;
  for (const scope of [frame, page]) {
    for (const selector of closeSelectors) {
      const buttons = scope.locator(selector);
      const count = Math.min(await buttons.count().catch(() => 0), 10);
      for (let index = count - 1; index >= 0; index -= 1) {
        const button = buttons.nth(index);
        if (!await button.isVisible().catch(() => false)) continue;
        await button.click({ force: true, timeout: 2000 }).catch(() => {});
        clicked = true;
        break;
      }
      if (clicked) break;
    }
    if (clicked) break;
  }
  await frame.getByText(new RegExp(`^Parte\\s+${part}$`, "i")).waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
}

async function visibleNorayPartNumbers(frame) {
  const controls = frame.locator('a:visible, button:visible, [role="button"]:visible, [onclick]:visible, td:visible, span:visible');
  const values = await controls.evaluateAll((nodes) => nodes
    .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim())
    .filter((text) => /^\d{5,6}$/.test(text))).catch(() => []);
  return [...new Set(values)];
}

async function openNorayPartFromVisibleNumber(page, frame, part) {
  const candidates = frame.getByText(part, { exact: true });
  const count = Math.min(await candidates.count().catch(() => 0), 12);
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible().catch(() => false)) continue;
    const clicked = await candidate.click({ force: true, noWaitAfter: true, timeout: 5000 })
      .then(() => true)
      .catch(() => candidate.evaluate((node) => {
        const actionable = node.closest('a, button, [role="button"], [onclick]') || node;
        actionable.click();
        return true;
      }).catch(() => false));
    if (!clicked) continue;
    const detail = await readOpenedNorayPart(page, part);
    if (detail.recognized && String(detail.parte || "") === part) return detail;
  }
  return null;
}

async function clickPreviousNorayMonth(frame) {
  const buttons = frame.locator('button:visible, [role="button"]:visible');
  const metadata = await buttons.evaluateAll((nodes) => nodes.map((node, index) => ({
    index,
    label: [
      node.textContent,
      node.getAttribute("aria-label"),
      node.getAttribute("title"),
      node.innerHTML
    ].filter(Boolean).join(" ")
  }))).catch(() => []);
  const previous = metadata.find((item) => /(?:mes\s+anterior|previous|prev|chevron-left|arrow-left)/i.test(item.label));
  if (!previous) return false;
  await buttons.nth(previous.index).click({ force: true, timeout: 5000 });
  return true;
}

async function collectNorayWorkersFromPartModals(page, frame, historyMonths, partsNeedingModal) {
  const workers = new Map();
  const scannedParts = new Set();
  let previousSignature = "";
  for (let monthIndex = 0; monthIndex < historyMonths; monthIndex += 1) {
    await page.waitForTimeout(700);
    const visibleParts = await visibleNorayPartNumbers(frame);
    const parts = visibleParts.filter((part) => partsNeedingModal.has(part));
    const signature = visibleParts.join(",");
    if (!signature || (monthIndex > 0 && signature === previousSignature)) break;
    previousSignature = signature;
    console.log(`[bolsa-scan:${portalUser}] Jornales mes ${monthIndex + 1}: ${visibleParts.length} parte(s), ${parts.length} requieren abrir el modal.`);
    for (const part of parts) {
      console.log(`[bolsa-scan:${portalUser}] Pulsando el numero de parte ${part}...`);
      const detail = await openNorayPartFromVisibleNumber(page, frame, part);
      if (detail) {
        scannedParts.add(part);
        for (const specialty of detail.specialties || []) {
          for (const candidateWorker of specialty.workers || []) {
            const worker = validBolsaWorker(candidateWorker);
            if (!worker) continue;
            const previous = workers.get(worker.chapa);
            if (!previous || worker.nombre.length > previous.nombre.length) workers.set(worker.chapa, worker);
          }
        }
        await closeNorayPartModal(page, frame, part);
        console.log(`[bolsa-scan:${portalUser}] Parte ${part} abierto y revisado.`);
      } else {
        console.warn(`[bolsa-scan:${portalUser}] El numero ${part} estaba visible, pero no abrio el detalle.`);
      }
    }
    if (scannedParts.size >= partsNeedingModal.size) break;
    if (monthIndex + 1 >= historyMonths || !await clickPreviousNorayMonth(frame)) break;
    await page.waitForTimeout(700);
  }
  return { workers: [...workers.values()], partsScanned: scannedParts.size };
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

  const recentParts = recentCompletedNorayParts(monthRows, 2);
  const partKeys = new Map(recentParts.map((part) => [`${part.year}:${part.parte}`, part]));
  console.log(`[bolsa-scan:${portalUser}] Se revisaran solo los dos partes completos mas recientes: ${recentParts.map((part) => part.parte).join(", ") || "ninguno"}.`);
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
  // Aunque la API aporte parte del equipo, el nombre oficial solo queda
  // confirmado al abrir el detalle desde el numero visible en Jornales.
  const partsNeedingModal = new Set(recentParts.map((part) => part.parte));

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
  let modalPartsScanned = 0;
  try {
    const modalResult = partsNeedingModal.size
      ? await collectNorayWorkersFromPartModals(page, auth.frame, historyMonths, partsNeedingModal)
      : { workers: [], partsScanned: 0 };
    if (!partsNeedingModal.size) {
      console.log(`[bolsa-scan:${portalUser}] Todos los equipos llegaron completos por Jornales; no hace falta abrir modales.`);
    }
    modalPartsScanned = modalResult.partsScanned;
    for (const worker of modalResult.workers) {
      const previous = workers.get(worker.chapa);
      if (!previous || worker.nombre.length > previous.nombre.length) workers.set(worker.chapa, worker);
    }
  } catch (error) {
    console.warn(`[bolsa-scan:${portalUser}] No se pudieron recorrer los modales de Jornales: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    observations,
    workers: [...workers.values()],
    partsScanned: Math.max(details.size, modalPartsScanned),
    premiumsFound: observations.filter((row) => row.premium_amount !== null).length,
    premiumsVerified
  };
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
    const found = new Map(noray.workers.map((worker) => [worker.chapa, worker]));
    const workers = [...found.values()].sort((a, b) => a.chapa.localeCompare(b.chapa));
    const saved = await saveWorkers(workers);
    const totalParts = noray.partsScanned;
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
