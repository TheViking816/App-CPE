import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const baseUrl = "https://wvwdiywtlbffumshbboa.supabase.co";
const serviceRole = resolveSupabaseAdminKey();
const targetChapa = String(process.argv[2] || "").trim();
const columns = [
  "id", "chapa", "portal_password", "security_key", "status", "message",
  "requested_at", "started_at", "finished_at", "expires_at", "created_at",
  "trigger_source", "schedule_slot", "request_kind", "document_id"
];

if (!serviceRole) throw new Error("Falta la clave de servicio cifrada.");
if (!/^\d{5}$/.test(targetChapa)) throw new Error("Chapa de laboratorio no válida.");

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: supabaseAdminHeaders(serviceRole, {
      "Content-Type": "application/json",
      ...(options.headers || {})
    })
  });
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function comparable(row) {
  return Object.fromEntries(columns.filter((column) => column !== "id" && column !== "chapa")
    .map((column) => [column, row[column] ?? null]));
}

await request("/rest/v1/app_cpe_portal_sync_jobs?status=eq.running", {
  method: "PATCH",
  headers: { Prefer: "return=minimal" },
  body: JSON.stringify({
    status: "queued",
    message: "En cola; worker pausado para prueba aislada",
    started_at: null,
    finished_at: null
  })
});

const originalRows = await request(`/rest/v1/app_cpe_portal_sync_jobs?select=${columns.join(",")}`);
if (!originalRows.some((row) => row.chapa === targetChapa)) throw new Error("No existe la fila de laboratorio.");

const rpcResult = await request("/rest/v1/rpc/app_cpe_create_worker_manual_jobs", { method: "POST", body: "{}" });
for (const row of originalRows) {
  if (row.chapa === targetChapa) continue;
  await request(`/rest/v1/app_cpe_portal_sync_jobs?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(comparable(row))
  });
}

const currentRows = await request(`/rest/v1/app_cpe_portal_sync_jobs?select=${columns.join(",")}`);
for (const original of originalRows) {
  if (original.chapa === targetChapa) continue;
  const current = currentRows.find((row) => row.id === original.id);
  const originalState = comparable(original);
  const currentState = comparable(current || {});
  const mismatchedFields = Object.keys(originalState)
    .filter((field) => JSON.stringify(originalState[field]) !== JSON.stringify(currentState[field]));
  if (!current || mismatchedFields.length) {
    throw new Error(`No se pudo restaurar el estado de ${original.chapa}: ${mismatchedFields.join(",")}.`);
  }
}

const target = currentRows.find((row) => row.chapa === targetChapa);
if (!target?.portal_password || target.status !== "queued") {
  throw new Error(
    `No se pudo preparar la fila de laboratorio: status=${target?.status || "missing"}, credential=${Boolean(target?.portal_password)}, queued=${rpcResult?.queued ?? "?"}, skipped=${rpcResult?.skipped ?? "?"}.`
  );
}
console.log(JSON.stringify({ ok: true, jobId: target.id, chapa: targetChapa, preserved: originalRows.length - 1 }));
