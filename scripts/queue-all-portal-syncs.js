import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const projectRef = "wvwdiywtlbffumshbboa";
const supabaseUrl = String(process.env.CPE_SUPABASE_URL || `https://${projectRef}.supabase.co`).replace(/\/$/, "");
const adminKey = resolveSupabaseAdminKey();
const fullHistory = process.argv.includes("--full-history");
const currentMonth = process.argv.includes("--current-month");

if (!adminKey) throw new Error("Missing CPE_SUPABASE_SECRET_KEY or CPE_SUPABASE_SERVICE_ROLE");
if (fullHistory === currentMonth) {
  throw new Error("Indica exactamente un modo: --full-history o --current-month");
}

const response = await fetch(`${supabaseUrl}/rest/v1/rpc/app_cpe_create_worker_manual_jobs`, {
  method: "POST",
  headers: supabaseAdminHeaders(adminKey, { "Content-Type": "application/json" }),
  body: JSON.stringify({ p_full_history: fullHistory })
});

if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${await response.text()}`);
const result = await response.json();
const modeLabel = fullHistory ? "carga completa anual" : "actualizacion del mes actual";
console.log(`Modo: ${modeLabel}.`);
console.log(`Trabajos encolados: ${Number(result?.queued || 0)}. Ya ejecutandose: ${Number(result?.skipped || 0)}.`);
