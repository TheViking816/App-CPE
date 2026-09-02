import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const projectRef = "wvwdiywtlbffumshbboa";
const supabaseUrl = String(process.env.CPE_SUPABASE_URL || `https://${projectRef}.supabase.co`).replace(/\/$/, "");
const adminKey = resolveSupabaseAdminKey();
const monthKey = String(process.argv[2] || "").trim();

if (!adminKey) throw new Error("Falta la clave de servicio para validar descansos.");
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) throw new Error("Mes de validacion no valido.");

const [year, month] = monthKey.split("-").map(Number);
const nextYear = month === 12 ? year + 1 : year;
const nextMonth = month === 12 ? 1 : month + 1;
const expected = [monthKey, `${nextYear}-${String(nextMonth).padStart(2, "0")}`];

async function request(path) {
  const response = await fetch(`${supabaseUrl}${path}`, { headers: supabaseAdminHeaders(adminKey) });
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

const [jobs, snapshots] = await Promise.all([
  request("/rest/v1/app_cpe_portal_sync_jobs?select=chapa,status&status=eq.completed"),
  request("/rest/v1/app_cpe_portal_snapshots?select=chapa,payload&limit=1000")
]);
const snapshotByChapa = new Map(snapshots.map((row) => [String(row.chapa), row]));
const invalid = jobs.filter((job) => {
  const months = (snapshotByChapa.get(String(job.chapa))?.payload?.descansos?.months || [])
    .map((item) => `${Number(item?.year)}-${String(Number(item?.month)).padStart(2, "0")}`);
  return months.length !== 2 || months.some((value, index) => value !== expected[index]);
});

console.log(JSON.stringify({
  ok: jobs.length > 0 && invalid.length === 0,
  expected,
  checked: jobs.length,
  valid: jobs.length - invalid.length,
  invalid: invalid.map((job) => job.chapa)
}));
if (!jobs.length || invalid.length) process.exitCode = 1;
