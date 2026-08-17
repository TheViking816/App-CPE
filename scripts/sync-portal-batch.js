import { spawn } from "node:child_process";

const projectRef = "wvwdiywtlbffumshbboa";
const serviceRole = process.env.CPE_SUPABASE_SERVICE_ROLE;
const supabaseUrl = resolveSupabaseUrl(process.env.CPE_SUPABASE_URL);
const jobIds = String(process.env.CPE_PORTAL_SYNC_JOB_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => /^[0-9a-f-]{36}$/i.test(value));

function resolveSupabaseUrl(value) {
  const normalized = String(value || projectRef).replace(/\r|\n/g, "").trim().split(/\s+/)[0];
  if (/^https?:\/\//i.test(normalized)) return new URL(normalized).origin;
  return `https://${/^[a-z0-9]{20}$/i.test(normalized) ? normalized : projectRef}.supabase.co`;
}

function runJob(jobId) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/sync-portal-oficial-job.js", jobId], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env, CPE_PORTAL_SYNC_JOB_ID: jobId }
    });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function stopRemainingJobs(remainingJobIds) {
  if (!remainingJobIds.length) return;
  const response = await fetch(
    `${supabaseUrl}/rest/v1/app_cpe_portal_sync_jobs?id=in.(${remainingJobIds.join(",")})`,
    {
      method: "PATCH",
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        status: "failed",
        message: "Lote detenido para evitar nuevos bloqueos del portal oficial.",
        portal_password: null,
        security_key: null,
        finished_at: new Date().toISOString()
      })
    }
  );
  if (!response.ok) throw new Error(`No se pudo cerrar el resto del lote: ${response.status}`);
}

async function main() {
  if (!serviceRole) throw new Error("Missing CPE_SUPABASE_SERVICE_ROLE");
  if (!jobIds.length) throw new Error("No hay trabajos validos en el lote");

  let completed = 0;
  for (let index = 0; index < jobIds.length; index += 1) {
    console.log(`Procesando sincronizacion ${index + 1} de ${jobIds.length}`);
    const ok = await runJob(jobIds[index]);
    if (!ok) {
      const remaining = jobIds.slice(index + 1);
      console.warn(`Lectura detenida tras el primer fallo; se omiten ${remaining.length} trabajos para proteger el portal.`);
      await stopRemainingJobs(remaining);
      break;
    }
    completed += 1;
    if (index + 1 < jobIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 30000));
    }
  }

  console.log(`Lote terminado: ${completed} de ${jobIds.length} sincronizaciones correctas.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "No se pudo procesar el lote");
  process.exitCode = 1;
});
