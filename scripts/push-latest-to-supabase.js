import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDataDir = path.join(rootDir, "public", "data");
const statusPath = path.join(publicDataDir, "puertas-sync-status.json");

const supabaseUrl = process.env.CPE_SUPABASE_URL;
const supabaseServiceRole = process.env.CPE_SUPABASE_SERVICE_ROLE;
const defaultProjectRef = "wvwdiywtlbffumshbboa";

function resolveSupabaseUrl(value) {
  const firstLine = String(value || "").trim().split(/\s+/)[0] || defaultProjectRef;

  if (/^https?:\/\//i.test(firstLine)) {
    return firstLine.replace(/\/$/, "");
  }

  if (/^[a-z0-9]{20}$/i.test(firstLine)) {
    return `https://${firstLine}.supabase.co`;
  }

  return `https://${defaultProjectRef}.supabase.co`;
}

async function writeStatus(status) {
  await fs.writeFile(statusPath, JSON.stringify(status, null, 2), "utf8");
}

async function main() {
  const payloadPath = path.join(publicDataDir, "puertas-conductor-1a.json");
  const payload = JSON.parse(await fs.readFile(payloadPath, "utf8"));

  if (!supabaseServiceRole) {
    await writeStatus({
      ok: false,
      stage: "supabase-env",
      updatedAt: new Date().toISOString(),
      supabaseConfigured: false,
      message: "Missing CPE_SUPABASE_SERVICE_ROLE"
    });
    throw new Error("Missing CPE_SUPABASE_SERVICE_ROLE");
  }

  const restUrl = `${resolveSupabaseUrl(supabaseUrl)}/rest/v1/app_cpe_door_snapshots`;

  const response = await fetch(restUrl, {
    method: "POST",
    headers: {
      "apikey": supabaseServiceRole,
      "Authorization": `Bearer ${supabaseServiceRole}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({
      specialty: payload.specialty,
      source: payload.source,
      doors: payload.doors,
      raw_columns: payload.rawColumns,
      updated_at: payload.updatedAt
    })
  });

  if (!response.ok) {
    const message = `HTTP ${response.status}: ${await response.text()}`;
    await writeStatus({
      ok: false,
      stage: "supabase-insert",
      updatedAt: new Date().toISOString(),
      supabaseConfigured: true,
      message
    });
    throw new Error(message);
  }

  await writeStatus({
    ok: true,
    stage: "supabase-insert",
    updatedAt: payload.updatedAt,
    supabaseConfigured: true,
    doors: payload.doors.map((door) => ({ key: door.key, raw: door.raw }))
  });

  console.log("OK: snapshot insertado en Supabase");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
