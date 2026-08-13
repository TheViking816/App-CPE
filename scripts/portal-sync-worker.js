import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { chromium } from "playwright";

const projectRef = "wvwdiywtlbffumshbboa";
const supabaseUrl = resolveSupabaseUrl(process.env.CPE_SUPABASE_URL);
const serviceRole = process.env.CPE_SUPABASE_SERVICE_ROLE;
const pollMs = Math.max(1000, Number(process.env.CPE_PORTAL_WORKER_POLL_MS || 2500));
const pollGlobalQueue = /^(1|true|yes)$/i.test(process.env.CPE_PORTAL_WORKER_POLL_GLOBAL || "");
const allowedOrigins = new Set(
  String(process.env.CPE_PORTAL_WORKER_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const allowedVercelHostPattern = /^cpe-[a-z0-9-]+-thevikings-projects\.vercel\.app$/i;
let stopping = false;
let browserServer = null;
let sessionRunner = null;
let activeJobId = null;
const requestedJobs = [];
const requestedBySession = new Map();
const sessionByJob = new Map();
const startedAt = new Date().toISOString();
const port = Math.max(1, Number(process.env.PORT || 8080));

function resolveSupabaseUrl(value) {
  const normalized = String(value || projectRef).replace(/\r|\n/g, "").trim().split(/\s+/)[0];
  if (/^https?:\/\//i.test(normalized)) return new URL(normalized).origin;
  return `https://${/^[a-z0-9]{20}$/i.test(normalized) ? normalized : projectRef}.supabase.co`;
}

async function request(path, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function claimNextJob() {
  const now = encodeURIComponent(new Date().toISOString());
  const jobs = await request(`/rest/v1/app_cpe_portal_sync_jobs?select=id&status=eq.queued&expires_at=gt.${now}&order=requested_at.asc&limit=1`);
  const jobId = jobs?.[0]?.id;
  if (!jobId) return null;

  const claimed = await request(`/rest/v1/app_cpe_portal_sync_jobs?id=eq.${encodeURIComponent(jobId)}&status=eq.queued`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "running", started_at: new Date().toISOString(), message: "Lectura iniciada" })
  });
  return claimed?.[0]?.id || null;
}

async function claimJob(jobId) {
  const claimed = await request(`/rest/v1/app_cpe_portal_sync_jobs?id=eq.${encodeURIComponent(jobId)}&status=eq.queued`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "running", started_at: new Date().toISOString(), message: "Lectura iniciada" })
  });
  return claimed?.[0]?.id || null;
}

async function createSyncJob({ token, portalPassword = "", securityKey = "" }) {
  const rpc = portalPassword ? "app_cpe_create_portal_sync_job" : "app_cpe_create_portal_sync_job_from_saved";
  const body = portalPassword
    ? { p_token: token, p_portal_password: portalPassword, p_security_key: securityKey }
    : { p_token: token };
  return request(`/rest/v1/rpc/${rpc}`, { method: "POST", body: JSON.stringify(body) });
}

function sessionKey(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function releaseRequestedJob(jobId) {
  const key = sessionByJob.get(jobId);
  if (key && requestedBySession.get(key) === jobId) requestedBySession.delete(key);
  sessionByJob.delete(jobId);
}

function corsHeaders(origin) {
  const allowed = isAllowedOrigin(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "null",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    Vary: "Origin"
  };
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && allowedVercelHostPattern.test(url.hostname);
  } catch {
    return false;
  }
}

async function readJson(request, limit = 16_384) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > limit) throw new Error("Solicitud demasiado grande");
  }
  return raw ? JSON.parse(raw) : {};
}

function startSessionRunner(wsEndpoint) {
  if (sessionRunner && !sessionRunner.killed) return sessionRunner;
  sessionRunner = spawn(process.execPath, ["scripts/portal-sync-session-runner.js"], {
    cwd: process.cwd(),
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    env: {
      ...process.env,
      CPE_PORTAL_BROWSER_WS_ENDPOINT: wsEndpoint,
      CPE_PORTAL_REUSE_CONTEXT: "true",
      CPE_PORTAL_IN_PROCESS: "true",
      CPE_PORTAL_PROGRESSIVE: "true",
      CPE_PORTAL_HEADLESS: "true",
      CPE_PORTAL_BROWSER_CHANNEL: "bundled"
    }
  });
  sessionRunner.on("exit", () => {
    sessionRunner = null;
  });
  return sessionRunner;
}

function runJob(jobId, wsEndpoint) {
  return new Promise((resolve) => {
    activeJobId = jobId;
    const runner = startSessionRunner(wsEndpoint);
    const onMessage = (message) => {
      if (message?.jobId !== jobId) return;
      runner.off("message", onMessage);
      console.log(`[portal-worker] ${jobId} finalizo con codigo ${message.ok ? 0 : 1}`);
      releaseRequestedJob(jobId);
      activeJobId = null;
      resolve();
    };
    runner.on("message", onMessage);
    runner.once("error", (error) => {
      console.error(`[portal-worker] No se pudo iniciar ${jobId}:`, error);
      runner.off("message", onMessage);
      releaseRequestedJob(jobId);
      activeJobId = null;
      resolve();
    });
    runner.send({ type: "run", jobId });
  });
}

async function main() {
  if (!serviceRole) throw new Error("Missing CPE_SUPABASE_SERVICE_ROLE");
  browserServer = await chromium.launchServer({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
  });
  const wsEndpoint = browserServer.wsEndpoint();
  createServer(async (incoming, response) => {
    const origin = String(incoming.headers.origin || "");
    const headers = { "Content-Type": "application/json", ...corsHeaders(origin) };
    if (incoming.method === "OPTIONS") {
      response.writeHead(204, headers).end();
      return;
    }
    if (incoming.url === "/health" && incoming.method === "GET") {
      response.writeHead(200, headers);
      response.end(JSON.stringify({ ok: true, startedAt, activeJobId, queued: requestedJobs.length }));
      return;
    }
    if (incoming.url === "/sync" && incoming.method === "POST") {
      if (!isAllowedOrigin(origin)) {
        response.writeHead(403, headers).end(JSON.stringify({ ok: false, error: "Origen no permitido" }));
        return;
      }
      try {
        const body = await readJson(incoming);
        if (!body.token) throw new Error("Sesion no valida");
        const key = sessionKey(body.token);
        const existingJobId = requestedBySession.get(key);
        if (existingJobId) {
          response.writeHead(202, headers);
          response.end(JSON.stringify({ jobId: existingJobId, executionMode: "persistent-test", triggered: false, reused: true }));
          return;
        }
        const job = await createSyncJob(body);
        if (!job?.jobId) throw new Error("No se pudo crear la sincronizacion");
        requestedBySession.set(key, job.jobId);
        sessionByJob.set(job.jobId, key);
        requestedJobs.push(job.jobId);
        response.writeHead(202, headers);
        response.end(JSON.stringify({ ...job, executionMode: "persistent-test", triggered: true }));
      } catch (error) {
        response.writeHead(400, headers);
        response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Solicitud no valida" }));
      }
      return;
    }
    response.writeHead(404, headers).end(JSON.stringify({ ok: false, error: "Ruta no encontrada" }));
  }).listen(port, "0.0.0.0");
  console.log(`[portal-worker] Escuchando ${supabaseUrl}; cola global ${pollGlobalQueue ? "activa" : "aislada"}`);
  while (!stopping) {
    try {
      const requestedJobId = requestedJobs.shift();
      const jobId = requestedJobId
        ? await claimJob(requestedJobId)
        : pollGlobalQueue ? await claimNextJob() : null;
      if (jobId) await runJob(jobId, wsEndpoint);
      else {
        if (requestedJobId) releaseRequestedJob(requestedJobId);
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    } catch (error) {
      console.error("[portal-worker]", error);
      await new Promise((resolve) => setTimeout(resolve, Math.max(pollMs, 5000)));
    }
  }
}

async function stop() {
  stopping = true;
  await browserServer?.close().catch(() => {});
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
