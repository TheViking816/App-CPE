import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const key = resolveSupabaseAdminKey();
const url = "https://wvwdiywtlbffumshbboa.supabase.co/rest/v1/app_cpe_portal_sync_jobs?select=id&limit=1";

async function main() {
  if (!key) {
    console.error("Falta la credencial cifrada del worker.");
    return 1;
  }

  try {
    const response = await fetch(url, { headers: supabaseAdminHeaders(key) });
    if (response.ok) return 0;
    const body = await response.text();
    if (response.status === 401 && /PGRST303|JWT issued at future/i.test(body)) {
      console.error("Supabase todavía no acepta temporalmente la credencial del worker.");
      return 75;
    }
    console.error(`Supabase rechazó el acceso del worker (HTTP ${response.status}).`);
    return 1;
  } catch (error) {
    console.error(`No se pudo conectar con Supabase: ${error instanceof Error ? error.message : "error de red"}`);
    return 75;
  }
}

process.exitCode = await main();
