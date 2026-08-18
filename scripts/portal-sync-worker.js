import { spawn } from "node:child_process";
import path from "node:path";
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
let stopping = false;

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
  const jobs = await request(`/rest/v1/app_cpe_portal_sync_jobs?select=id,chapa&status=eq.queued&order=requested_at.asc&limit=${batchSize}`);
  if (!jobs?.length) return [];

  const ids = jobs.map((job) => encodeURIComponent(job.id)).join(",");
  const claimed = await request(`/rest/v1/app_cpe_portal_sync_jobs?select=id,chapa&id=in.(${ids})&status=eq.queued`, {
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

function profileForJob(job) {
  const chapa = String(job?.chapa || "").trim();
  if (!/^\d{3,12}$/.test(chapa)) {
    throw new Error(`Chapa no valida para el perfil de Chrome: ${chapa || "vacia"}`);
  }
  return path.resolve(
    parallelProfileRoot || path.join("data", "portal-oficial-chrome-profile"),
    chapa
  );
}

function runJob(job, slot) {
  return new Promise((resolve) => {
    const profileDir = profileForJob(job);
    const child = spawn(process.execPath, ["scripts/sync-portal-oficial-job.js", job.id], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: {
        ...process.env,
        CPE_PORTAL_SYNC_JOB_ID: job.id,
        ...(profileDir ? { CPE_PORTAL_PROFILE_DIR: profileDir } : {})
      }
    });
    child.on("error", (error) => {
      console.error(`[portal-worker:${slot}] No se pudo iniciar ${job.id}:`, error);
      resolve();
    });
    child.on("exit", (code) => {
      console.log(`[portal-worker:${slot}] ${job.id} finalizo con codigo ${code}`);
      resolve();
    });
  });
}

async function workerLoop() {
  while (!stopping) {
    try {
      const jobs = await claimNextBatch();
      if (jobs.length) {
        console.log(`[portal-worker] Iniciando tanda de ${jobs.length}`);
        await Promise.all(jobs.map((job, index) => runJob(job, index + 1)));
        console.log(`[portal-worker] Tanda de ${jobs.length} finalizada`);
      } else {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    } catch (error) {
      console.error("[portal-worker]", error);
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
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
