import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const projectRef = "wvwdiywtlbffumshbboa";
const supabaseUrl = String(process.env.CPE_SUPABASE_URL || `https://${projectRef}.supabase.co`).replace(/\/$/, "");
const adminKey = resolveSupabaseAdminKey();

if (!adminKey) throw new Error("Missing CPE_SUPABASE_SECRET_KEY or CPE_SUPABASE_SERVICE_ROLE");

const response = await fetch(`${supabaseUrl}/rest/v1/rpc/app_cpe_create_worker_manual_jobs`, {
  method: "POST",
  headers: supabaseAdminHeaders(adminKey, { "Content-Type": "application/json" }),
  body: "{}"
});

if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${await response.text()}`);
const result = await response.json();
console.log(`Trabajos encolados: ${Number(result?.queued || 0)}. Ya pendientes: ${Number(result?.skipped || 0)}.`);
