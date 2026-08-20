import { spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright";
import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const projectRef = "wvwdiywtlbffumshbboa";
const supabaseUrl = resolveSupabaseUrl(process.env.CPE_SUPABASE_URL);
const serviceRole = resolveSupabaseAdminKey();
const pollMs = Math.max(1000, Number(process.env.CPE_PORTAL_WORKER_POLL_MS || 2500));
const batchSize = Math.max(1, Math.min(32, Number(
  process.env.CPE_PORTAL_WORKER_BATCH_SIZE
  || process.env.CPE_PORTAL_WORKER_CONCURRENCY
  || 10
)));
const parallelProfileRoot = String(process.env.CPE_PORTAL_WORKER_PROFILE_ROOT || "").trim();
const portalCdpEndpoint = String(process.env.CPE_PORTAL_CDP_ENDPOINT || "").trim();
const portalBrowserProvider = String(process.env.CPE_PORTAL_BROWSER_PROVIDER || "gateway").trim().toLowerCase();
const scrapflyMode = portalBrowserProvider === "scrapfly";
const workerOnce = /^(1|true|yes)$/i.test(process.env.CPE_PORTAL_WORKER_ONCE || "");
const workerDrain = /^(1|true|yes)$/i.test(process.env.CPE_PORTAL_WORKER_DRAIN || "");
const challengePattern = /Verificaci[oó]n de seguridad|verifique que es un ser humano|challenge-platform|cf-chl-|Just a moment/i;
const portalPattern = /Iniciar sesi[oó]n|loginFields|title=["']Usuario["']|Finalizar sesi[oó]n/i;
let stopping = false;
let gatewayBrowser = null;
let gatewayStartPromise = null;
let lastGeneralBoardBatchKey = "";

function resolveSupabaseUrl(value) {
  const normalized = String(value || projectRef).replace(/\r|\n/g, "").trim().split(/\s+/)[0];
  if (/^https?:\/\//i.test(normalized)) return new URL(normalized).origin;
  return `https://${/^[a-z0-9]{20}$/i.test(normalized) ? normalized : projectRef}.supabase.co`;
}

async function request(path, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: supabaseAdminHeaders(serviceRole, {
      "Content-Type": "application/json",
      ...(options.headers || {})
    })
  });
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function claimNextBatch() {
  await failQueuedJobsWithoutCredentials();
  const jobs = await request(`/rest/v1/app_cpe_portal_sync_jobs?select=id,chapa,trigger_source,requested_at,request_kind&status=eq.queued&portal_password=not.is.null&order=requested_at.asc&limit=${batchSize}`);
  if (!jobs?.length) return [];

  const ids = jobs.map((job) => encodeURIComponent(job.id)).join(",");
  const claimed = await request(`/rest/v1/app_cpe_portal_sync_jobs?select=id,chapa,trigger_source,requested_at,request_kind,portal_password&id=in.(${ids})&status=eq.queued`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status: "running",
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      message: "Lectura iniciada"
    })
  });
  return claimed || [];
}

function generalBoardBatchKey(job) {
  const requestedAt = new Date(job?.requested_at || 0);
  if (!Number.isFinite(requestedAt.getTime())) return "";
  requestedAt.setSeconds(0, 0);
  return requestedAt.toISOString();
}

function runGeneralBoard(job, clearanceCookies = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/sync-general-board.js"], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: {
        ...process.env,
        CPE_PORTAL_USER: job.chapa,
        CPE_PORTAL_PASSWORD: job.portal_password,
        CPE_GENERAL_BOARD_PROFILE_DIR: profileForSlot("general-board"),
        CPE_PORTAL_CLEARANCE_COOKIES: JSON.stringify(clearanceCookies)
      }
    });
    child.once("error", (error) => {
      console.error("[portal-worker:tablon] No se pudo iniciar:", error.message);
      resolve(false);
    });
    child.once("exit", (code) => {
      console.log(`[portal-worker:tablon] finalizo con codigo ${code}`);
      resolve(code === 0);
    });
  });
}

async function failQueuedJobsWithoutCredentials() {
  await request("/rest/v1/app_cpe_portal_sync_jobs?status=eq.queued&portal_password=is.null", {
    method: "PATCH",
    body: JSON.stringify({
      status: "failed",
      message: "No hay claves disponibles para ejecutar esta lectura",
      security_key: null,
      finished_at: new Date().toISOString()
    })
  });
}

function profileForSlot(slot) {
  return path.resolve(
    parallelProfileRoot || path.join("data", "portal-oficial-chrome-profile", "workers"),
    `worker-${slot}`
  );
}

function gatewayPort() {
  try {
    return Number(new URL(portalCdpEndpoint).port || 9223);
  } catch {
    return 9223;
  }
}

function startGatewayBrowser() {
  if (gatewayStartPromise) return gatewayStartPromise;
  gatewayStartPromise = new Promise((resolve, reject) => {
    const script = path.resolve("scripts", "windows", "start-cloudflare-gateway.ps1");
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-WindowStyle", "Hidden",
      "-File", script,
      "-Port", String(gatewayPort())
    ], {
      cwd: process.cwd(),
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`No se pudo reabrir Chrome gateway (codigo ${code}).`));
    });
  }).finally(() => {
    gatewayStartPromise = null;
  });
  return gatewayStartPromise;
}

async function ensureGatewayBrowser() {
  if (!portalCdpEndpoint) return null;
  if (gatewayBrowser?.isConnected()) return gatewayBrowser;

  gatewayBrowser = null;
  try {
    gatewayBrowser = await chromium.connectOverCDP(portalCdpEndpoint, { timeout: 5000 });
  } catch (firstError) {
    if (scrapflyMode) throw new Error(`No se pudo conectar con Scrapfly: ${firstError.message}`);
    console.warn("[portal-worker] El Chrome gateway se cerro; se abrira de nuevo automaticamente.");
    await startGatewayBrowser();
    gatewayBrowser = await chromium.connectOverCDP(portalCdpEndpoint, { timeout: 15000 });
  }
  return gatewayBrowser;
}

async function gatewayClearanceCookies() {
  const browser = await ensureGatewayBrowser();
  if (!browser) return [];
  const context = browser.contexts()[0];
  if (!context) return [];
  const cookies = await context.cookies("https://portal.cpevalencia.com");
  return cookies
    .filter((cookie) => cookie.name === "cf_clearance" || cookie.name.startsWith("cf_chl_"))
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite
    }));
}

async function gatewayAuthorizationIsValid() {
  const browser = await ensureGatewayBrowser();
  const cookies = await gatewayClearanceCookies();
  if (!browser || !cookies.some((cookie) => cookie.name === "cf_clearance")) return false;

  const context = await browser.newContext({
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    viewport: { width: 1365, height: 900 }
  });
  try {
    await context.addCookies(cookies);
    const page = await context.newPage();
    const response = await page.goto("https://portal.cpevalencia.com/#User", {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });
    const deadline = Date.now() + 15000;
    do {
      const contents = await Promise.all(page.frames().map((frame) => frame.content().catch(() => "")));
      const content = contents.join("\n");
      if (challengePattern.test(content) || (response?.status() || 0) === 403) return false;
      if (portalPattern.test(content)) return true;
      await page.waitForTimeout(500);
    } while (Date.now() < deadline);
    return false;
  } catch {
    return false;
  } finally {
    await context.close().catch(() => {});
  }
}

async function scrapflyAuthorizationIsValid() {
  const browser = await ensureGatewayBrowser();
  const context = browser?.contexts()[0];
  if (!context) return false;
  const existingPage = context.pages().find((page) => page.url().startsWith("https://portal.cpevalencia.com"));
  const page = existingPage || await context.newPage();
  try {
    const response = await page.goto("https://portal.cpevalencia.com/#User", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    const deadline = Date.now() + 20000;
    do {
      const contents = await Promise.all(page.frames().map((frame) => frame.content().catch(() => "")));
      const content = contents.join("\n");
      if (challengePattern.test(content) || (response?.status() || 0) === 403) return false;
      if (portalPattern.test(content)) return true;
      await page.waitForTimeout(500);
    } while (Date.now() < deadline);
    return false;
  } finally {
    if (!existingPage) await page.close().catch(() => {});
  }
}

function runJob(job, slot, clearanceCookies = []) {
  return new Promise((resolve) => {
    const profileDir = profileForSlot(slot);
    const child = spawn(process.execPath, ["scripts/sync-portal-oficial-job.js", job.id], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: {
        ...process.env,
        CPE_PORTAL_SYNC_JOB_ID: job.id,
        ...(portalCdpEndpoint && scrapflyMode
          ? {
              CPE_PORTAL_CDP_ENDPOINT: portalCdpEndpoint,
              CPE_PORTAL_CDP_CONTEXT_SLOT: "",
              CPE_PORTAL_CLEARANCE_COOKIES: ""
            }
          : portalCdpEndpoint
          ? {
              CPE_PORTAL_CDP_ENDPOINT: "",
              CPE_PORTAL_CDP_CONTEXT_SLOT: "",
              CPE_PORTAL_PROFILE_DIR: profileDir,
              CPE_PORTAL_CLEARANCE_COOKIES: JSON.stringify(clearanceCookies)
            }
          : (profileDir ? { CPE_PORTAL_PROFILE_DIR: profileDir } : {}))
      }
    });
    child.on("error", async (error) => {
      console.error(`[portal-worker:${slot}] No se pudo iniciar ${job.id}:`, error);
      await failRunningJob(job.id, "No se pudo iniciar el proceso de lectura").catch((failure) => {
        console.error(`[portal-worker:${slot}] No se pudo cerrar ${job.id}:`, failure);
      });
      resolve();
    });
    child.on("exit", async (code) => {
      console.log(`[portal-worker:${slot}] ${job.id} finalizo con codigo ${code}`);
      if (code !== 0) {
        await failRunningJob(job.id, `El proceso de lectura termino con codigo ${code}`).catch((failure) => {
          console.error(`[portal-worker:${slot}] No se pudo cerrar ${job.id}:`, failure);
        });
      }
      resolve();
    });
  });
}

async function failRunningJob(jobId, message) {
  await request(`/rest/v1/app_cpe_portal_sync_jobs?id=eq.${encodeURIComponent(jobId)}&status=eq.running`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "failed",
      message,
      portal_password: null,
      security_key: null,
      finished_at: new Date().toISOString()
    })
  });
}

async function requeueRunningJobs(jobs, message) {
  if (!jobs.length) return;
  const ids = jobs.map((job) => encodeURIComponent(job.id)).join(",");
  await request(`/rest/v1/app_cpe_portal_sync_jobs?id=in.(${ids})&status=eq.running`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "queued",
      message,
      started_at: null,
      finished_at: null
    })
  });
}

async function workerLoop() {
  while (!stopping) {
    try {
      const jobs = await claimNextBatch();
      if (jobs.length) {
        console.log(`[portal-worker] Iniciando tanda de ${jobs.length}`);
        try {
          let clearanceCookies = [];
          if (portalCdpEndpoint) {
            const authorizationValid = scrapflyMode
              ? await scrapflyAuthorizationIsValid()
              : await gatewayAuthorizationIsValid();
            if (!authorizationValid) {
              await requeueRunningJobs(jobs, "En cola; Chrome necesita verificacion de Cloudflare");
              console.warn(`[portal-worker] Tanda devuelta a la cola: ${scrapflyMode ? "Scrapfly no supero Cloudflare" : "Chrome necesita completar la verificacion de Cloudflare"}.`);
              if (workerOnce || workerDrain) return;
              await new Promise((resolve) => setTimeout(resolve, Math.max(pollMs, 30000)));
              continue;
            }
            clearanceCookies = scrapflyMode ? [] : await gatewayClearanceCookies();
            if (!scrapflyMode && !clearanceCookies.some((cookie) => cookie.name === "cf_clearance")) {
              await requeueRunningJobs(jobs, "En cola; Chrome necesita verificacion de Cloudflare");
              console.warn("[portal-worker] Tanda devuelta a la cola: falta autorizacion de Cloudflare.");
              if (workerOnce || workerDrain) return;
              continue;
            }
          }
          const boardJob = scrapflyMode
            ? null
            : jobs.find((job) => job.trigger_source === "worker_manual_all");
          const boardKey = generalBoardBatchKey(boardJob);
          const boardPromise = boardJob && boardKey && boardKey !== lastGeneralBoardBatchKey
            ? runGeneralBoard(boardJob, clearanceCookies).then((success) => {
              if (success) lastGeneralBoardBatchKey = boardKey;
            })
            : Promise.resolve();
          await Promise.all([
            ...jobs.map((job, index) => runJob(job, index + 1, clearanceCookies)),
            boardPromise
          ]);
          console.log(`[portal-worker] Tanda de ${jobs.length} finalizada`);
        } catch (error) {
          await requeueRunningJobs(jobs, "En cola; no se pudo preparar Chrome").catch(() => {});
          throw error;
        }
        if (workerOnce) return;
      } else {
        if (workerOnce || workerDrain) return;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    } catch (error) {
      console.error("[portal-worker]", error);
      if (workerDrain) return;
      await new Promise((resolve) => setTimeout(resolve, Math.max(pollMs, 5000)));
    }
  }
}

async function main() {
  if (!serviceRole) throw new Error("Missing CPE_SUPABASE_SECRET_KEY or CPE_SUPABASE_SERVICE_ROLE");
  console.log(`[portal-worker] Escuchando ${supabaseUrl} cada ${pollMs} ms en tandas de hasta ${batchSize}`);
  await workerLoop();
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
