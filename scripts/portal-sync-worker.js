import { spawn } from "node:child_process";

const projectRef = "wvwdiywtlbffumshbboa";
const supabaseUrl = resolveSupabaseUrl(process.env.CPE_SUPABASE_URL);
const serviceRole = process.env.CPE_SUPABASE_SERVICE_ROLE;
const pollMs = Math.max(1000, Number(process.env.CPE_PORTAL_WORKER_POLL_MS || 2500));
let stopping = false;

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

function runJob(jobId) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/sync-portal-oficial-job.js", jobId], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env, CPE_PORTAL_SYNC_JOB_ID: jobId }
    });
    child.on("error", (error) => {
      console.error(`[portal-worker] No se pudo iniciar ${jobId}:`, error);
      resolve();
    });
    child.on("exit", (code) => {
      console.log(`[portal-worker] ${jobId} finalizo con codigo ${code}`);
      resolve();
    });
  });
}

async function main() {
  if (!serviceRole) throw new Error("Missing CPE_SUPABASE_SERVICE_ROLE");
  console.log(`[portal-worker] Escuchando ${supabaseUrl} cada ${pollMs} ms`);
  while (!stopping) {
    try {
      const jobId = await claimNextJob();
      if (jobId) await runJob(jobId);
      else await new Promise((resolve) => setTimeout(resolve, pollMs));
    } catch (error) {
      console.error("[portal-worker]", error);
      await new Promise((resolve) => setTimeout(resolve, Math.max(pollMs, 5000)));
    }
  }
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
