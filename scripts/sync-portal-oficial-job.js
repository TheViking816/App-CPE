import { spawn } from "node:child_process";

const defaultProjectRef = "wvwdiywtlbffumshbboa";
const jobId = process.env.CPE_PORTAL_SYNC_JOB_ID || process.argv[2];
const supabaseUrl = resolveSupabaseUrl(process.env.CPE_SUPABASE_URL);
const serviceRole = process.env.CPE_SUPABASE_SERVICE_ROLE;

function resolveSupabaseUrl(value) {
  const firstLine = String(value || "")
    .replace(/\r|\n/g, "")
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

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase HTTP ${response.status}: ${await response.text()}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function updateJob(patch) {
  await supabaseRequest(`/rest/v1/app_cpe_portal_sync_jobs?id=eq.${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch)
  });
}

function runSync(job) {
  return new Promise((resolve, reject) => {
    let diagnostic = "";
    const child = spawn(process.execPath, ["scripts/sync-portal-oficial.js"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CPE_PORTAL_USER: job.chapa,
        CPE_PORTAL_PASSWORD: job.portal_password,
        CPE_PORTAL_SECURITY_KEY: job.security_key || "",
        CPE_PORTAL_FAST_MODE: job.trigger_source === "scheduled" ? "false" : "true",
        CPE_PORTAL_HEADLESS: process.env.CPE_PORTAL_HEADLESS || "false",
        CPE_PORTAL_BROWSER_CHANNEL: process.env.CPE_PORTAL_BROWSER_CHANNEL || "bundled"
      }
    });

    const forward = (stream, target) => {
      stream.on("data", (chunk) => {
        const text = chunk.toString();
        diagnostic = `${diagnostic}${text}`.slice(-4000);
        target.write(text);
      });
    };

    forward(child.stdout, process.stdout);
    forward(child.stderr, process.stderr);

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(diagnostic.trim() || `sync-portal-oficial.js exited with code ${code}`));
    });
  });
}

function publicErrorMessage(error) {
  const message = error instanceof Error ? error.message : "Error desconocido";
  return message
    .split(/\bMuestra:/i)[0]
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || "No se pudo leer el portal oficial.";
}

async function main() {
  if (!jobId) throw new Error("Missing CPE_PORTAL_SYNC_JOB_ID");
  if (!serviceRole) throw new Error("Missing CPE_SUPABASE_SERVICE_ROLE");

  const rows = await supabaseRequest(`/rest/v1/app_cpe_portal_sync_jobs?select=id,chapa,portal_password,security_key,status,expires_at,trigger_source&id=eq.${encodeURIComponent(jobId)}&limit=1`);
  const job = rows?.[0];
  if (!job) throw new Error("Portal sync job not found");

  if (!job.portal_password) {
    throw new Error("Portal sync job has no credentials");
  }

  if (new Date(job.expires_at).getTime() < Date.now()) {
    await updateJob({
      status: "failed",
      message: "La sincronizacion ha caducado. Vuelve a lanzar la lectura.",
      portal_password: null,
      security_key: null,
      finished_at: new Date().toISOString()
    });
    throw new Error("Portal sync job expired");
  }

  await updateJob({
    status: "running",
    message: "Leyendo portal oficial",
    started_at: new Date().toISOString()
  });

  try {
    await runSync(job);
    await updateJob({
      status: "completed",
      message: "Portal sincronizado",
      portal_password: null,
      security_key: null,
      finished_at: new Date().toISOString()
    });
  } catch (error) {
    await updateJob({
      status: "failed",
      message: publicErrorMessage(error),
      portal_password: null,
      security_key: null,
      finished_at: new Date().toISOString()
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Error desconocido");
  process.exit(1);
});
