import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const repositoryPath = path.resolve(process.env.CPE_REPOSITORY_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const supabaseUrl = String(process.env.CPE_SUPABASE_URL || "https://wvwdiywtlbffumshbboa.supabase.co").replace(/\/$/, "");
const adminKey = resolveSupabaseAdminKey();
const workerId = String(process.env.CPE_REMOTE_WORKER_ID || os.hostname() || "home-pc").slice(0, 120);
const pollMs = Math.max(5_000, Number(process.env.CPE_REMOTE_WORKER_POLL_MS || 10_000));
const logDirectory = path.join(process.env.LOCALAPPDATA || repositoryPath, "AppCPE", "portal-worker", "logs");
let stopping = false;
let running = false;

if (!adminKey) throw new Error("Falta la credencial cifrada de Supabase para el control remoto.");
mkdirSync(logDirectory, { recursive: true });

async function rpc(name, body = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: supabaseAdminHeaders(adminKey, { "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function heartbeat(status = running ? "executing" : "idle", message = running ? "Procesando trabajos pendientes" : "PC preparado") {
  await rpc("app_cpe_worker_heartbeat", { p_worker_id: workerId, p_status: status, p_message: message });
}

function runPendingSync() {
  const runner = path.join(repositoryPath, "scripts", "windows", "run-pending-sync.ps1");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const log = createWriteStream(path.join(logDirectory, `remote-pending-${stamp}.log`), { flags: "a" });
  const child = spawn("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", runner,
    "-RepositoryPath", repositoryPath
  ], { cwd: repositoryPath, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return new Promise((resolve) => {
    child.once("error", (error) => { log.end(); resolve({ code: 1, message: error.message }); });
    child.once("exit", (code) => { log.end(); resolve({ code: Number(code ?? 1), message: code === 0 ? "Trabajos pendientes procesados correctamente" : `El worker terminó con código ${code ?? 1}` }); });
  });
}

async function poll() {
  if (running || stopping) return;
  await heartbeat();
  const command = await rpc("app_cpe_claim_worker_command", { p_worker_id: workerId });
  if (!command?.id) return;
  running = true;
  await heartbeat("executing", "Abriendo Chrome y procesando pendientes");
  const result = await runPendingSync();
  await rpc("app_cpe_finish_worker_command", {
    p_id: command.id,
    p_worker_id: workerId,
    p_status: result.code === 0 ? "completed" : "failed",
    p_message: result.message
  });
  running = false;
  await heartbeat("idle", result.message);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; });
await heartbeat("idle", "PC preparado para órdenes remotas");
while (!stopping) {
  try { await poll(); }
  catch (error) { console.error(`[remote-worker] ${error instanceof Error ? error.message : error}`); }
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
