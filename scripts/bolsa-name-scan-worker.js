import { spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright";
import { syncBolsaWorkerDirectory } from "./bolsa-worker-directory.js";
import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const supabaseUrl = String(process.env.CPE_SUPABASE_URL || "https://wvwdiywtlbffumshbboa.supabase.co").replace(/\/$/, "");
const serviceRole = resolveSupabaseAdminKey();
const args = new Set(process.argv.slice(2));
const queueAll = args.has("--queue-all");
const once = args.has("--once");
const batchSize = Math.max(1, Math.min(6, Number(process.env.CPE_BOLSA_SCAN_BATCH_SIZE || 1)));
const cdpEndpoint = String(process.env.CPE_PORTAL_CDP_ENDPOINT || "http://127.0.0.1:9223").trim();
const claimedJobIds = [];

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

function startGateway() {
  return new Promise((resolve, reject) => {
    const script = path.resolve("scripts", "windows", "start-cloudflare-gateway.ps1");
    const child = spawn("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
      "-File", script, "-Port", String(new URL(cdpEndpoint).port || 9223)
    ], { cwd: process.cwd(), stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Chrome gateway termino con codigo ${code}`)));
  });
}

async function gatewayCookies() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 5000 });
  } catch {
    await startGateway();
    browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 15000 });
  }
  const context = browser.contexts()[0];
  if (!context) return [];
  return (await context.cookies("https://portal.cpevalencia.com"))
    .filter((cookie) => cookie.name === "cf_clearance" || cookie.name.startsWith("cf_chl_"));
}

async function createJobs() {
  const result = await request("/rest/v1/rpc/app_cpe_create_bolsa_name_scan_jobs", {
    method: "POST",
    body: "{}"
  });
  console.log(`[bolsa-scan] Cola preparada: ${result?.queued || 0} usuarios; ${result?.skipped || 0} omitidos.`);
}

async function claimJobs() {
  return request("/rest/v1/rpc/app_cpe_claim_bolsa_name_scan_jobs", {
    method: "POST",
    body: JSON.stringify({ p_limit: batchSize })
  });
}

function runJob(job, clearanceCookies) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/bolsa-name-scan-job.js"], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: {
        ...process.env,
        CPE_BOLSA_SCAN_JOB_ID: job.id,
        CPE_PORTAL_USER: job.chapa,
        CPE_PORTAL_PASSWORD: job.portal_password,
        CPE_PORTAL_SECURITY_KEY: job.security_key || "",
        CPE_BOLSA_SCAN_PROFILE_DIR: path.resolve("data", "portal-bolsa-name-scan-profiles", job.chapa),
        CPE_BOLSA_SCAN_USE_GATEWAY_CONTEXT: "true",
        CPE_PORTAL_CLEARANCE_COOKIES: JSON.stringify(clearanceCookies)
      }
    });
    child.once("error", (error) => {
      console.error(`[bolsa-scan:${job.chapa}] No se pudo iniciar: ${error.message}`);
      resolve(false);
    });
    child.once("exit", (code) => resolve(code === 0));
  });
}

async function failUnfinished(job, message) {
  await request("/rest/v1/rpc/app_cpe_finish_bolsa_name_scan_job", {
    method: "POST",
    body: JSON.stringify({
      p_id: job.id,
      p_ok: false,
      p_message: message,
      p_parts_scanned: 0,
      p_names_found: 0,
      p_new_workers: [],
      p_updated_workers: []
    })
  });
}

function uniqueWorkers(rows, field) {
  const workers = new Map();
  for (const row of rows || []) {
    for (const worker of Array.isArray(row[field]) ? row[field] : []) {
      if (worker?.chapa && worker?.nombre) workers.set(worker.chapa, worker);
    }
  }
  return [...workers.values()].sort((a, b) => a.chapa.localeCompare(b.chapa));
}

async function printSummary() {
  const idFilter = claimedJobIds.map((id) => `"${String(id).replaceAll('"', '')}"`).join(",");
  const rows = idFilter
    ? await request(`/rest/v1/app_cpe_bolsa_name_scan_jobs?select=chapa,status,parts_scanned,names_found,new_workers,updated_workers,message&id=in.(${encodeURIComponent(idFilter)})&order=chapa.asc`)
    : [];
  const newWorkers = uniqueWorkers(rows, "new_workers");
  const updatedWorkers = uniqueWorkers(rows, "updated_workers");
  const parts = (rows || []).reduce((total, row) => total + Number(row.parts_scanned || 0), 0);
  const completed = (rows || []).filter((row) => row.status === "completed").length;
  const failed = (rows || []).filter((row) => row.status === "failed").length;

  console.log("\n========== RESULTADO RASTREO BOLSA ==========");
  console.log(`Usuarios completados: ${completed} | Fallidos: ${failed} | Partes recorridos: ${parts}`);
  console.log(`Chapas y nombres NUEVOS guardados: ${newWorkers.length}`);
  newWorkers.forEach((worker) => console.log(`  ${worker.chapa}  ${worker.nombre}`));
  console.log(`Nombres existentes MEJORADOS: ${updatedWorkers.length}`);
  updatedWorkers.forEach((worker) => console.log(`  ${worker.chapa}  ${worker.nombre}${worker.anterior ? `  (antes: ${worker.anterior})` : ""}`));
  if (failed) {
    console.log("Fallos:");
    rows.filter((row) => row.status === "failed").forEach((row) => console.log(`  ${row.chapa}: ${row.message || "Error desconocido"}`));
  }
  console.log("==============================================\n");
  return { completed, failed, parts, newWorkers, updatedWorkers };
}

async function main() {
  if (!serviceRole) throw new Error("Falta CPE_SUPABASE_SECRET_KEY o CPE_SUPABASE_SERVICE_ROLE");
  if (queueAll) await createJobs();
  const clearanceCookies = await gatewayCookies();
  if (!clearanceCookies.some((cookie) => cookie.name === "cf_clearance")) {
    throw new Error("Chrome gateway necesita completar la verificacion de Cloudflare antes del rastreo");
  }

  do {
    const jobs = await claimJobs();
    if (!jobs?.length) break;
    claimedJobIds.push(...jobs.map((job) => job.id));
    console.log(`[bolsa-scan] Procesando ${jobs.length} usuario(s).`);
    for (const job of jobs) {
      const ok = await runJob(job, clearanceCookies);
      if (!ok) await failUnfinished(job, "El proceso aislado termino antes de guardar el resultado").catch(() => {});
    }
    if (once) break;
  } while (true);

  await syncBolsaWorkerDirectory().catch((error) => console.warn(`[bolsa-scan] No se pudo actualizar el archivo local: ${error.message}`));
  await printSummary();
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`[bolsa-scan] ${error instanceof Error ? error.message : error}`);
    // Let Node close pending fetch handles cleanly. A forced exit can trigger
    // a libuv assertion on Windows after an early Supabase error.
    process.exitCode = 1;
  }
);
