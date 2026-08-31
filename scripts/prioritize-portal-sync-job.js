import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const chapa = String(process.argv[2] || "").replace(/\D/g, "");
const supabaseUrl = String(process.env.CPE_SUPABASE_URL || "").replace(/\/$/, "");
const adminKey = resolveSupabaseAdminKey();

if (!/^\d{3,6}$/.test(chapa)) throw new Error("Indica una chapa valida.");
if (!supabaseUrl || !adminKey) throw new Error("Faltan las credenciales administrativas de Supabase.");

const headers = supabaseAdminHeaders(adminKey, { "Content-Type": "application/json" });
const query = new URLSearchParams({
  select: "id,status,requested_at",
  chapa: `eq.${chapa}`,
  status: "eq.queued",
  order: "requested_at.asc",
  limit: "1"
});
const lookup = await fetch(`${supabaseUrl}/rest/v1/app_cpe_portal_sync_jobs?${query}`, { headers });
if (!lookup.ok) throw new Error(`Supabase HTTP ${lookup.status}: ${await lookup.text()}`);
const [job] = await lookup.json();
if (!job) throw new Error(`No hay ningun trabajo en cola para la chapa ${chapa}.`);

const response = await fetch(`${supabaseUrl}/rest/v1/app_cpe_portal_sync_jobs?id=eq.${encodeURIComponent(job.id)}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ requested_at: "2000-01-01T00:00:00.000Z" })
});
if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${await response.text()}`);
console.log(`Trabajo ${job.id} de la chapa ${chapa} colocado al frente de la cola.`);
