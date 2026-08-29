import fs from "node:fs/promises";
import path from "node:path";
import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const APP_CPE_URL = String(process.env.CPE_SUPABASE_URL || "https://wvwdiywtlbffumshbboa.supabase.co").replace(/\/$/, "");
const PORTAL_URL = "https://icszzxkdxatfytpmoviq.supabase.co";
const PORTAL_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljc3p6eGtkeGF0Znl0cG1vdmlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2Mzk2NjUsImV4cCI6MjA3ODIxNTY2NX0.hmQWNB3sCyBh39gdNgQLjjlIvliwJje-OYf0kkPObVA";
const ASSET_PATH = path.resolve("assets", "bolsa-trabajadores.json");
const INVALID_NAMES = /^(?:PERSONAL DE BOLSA|SIN NOMBRE(?: PUBLICADO)?|CHAPA\s+\d+|CERO)$/i;

export function normalizeBolsaChapa(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  if (/^80[0-9]{3}$/.test(digits)) return digits;
  if (/^[0-9]{1,3}$/.test(digits)) return `80${digits.padStart(3, "0")}`;
  return "";
}

function cleanName(value) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  return name.length >= 2 && !INVALID_NAMES.test(name) ? name : "";
}

async function fetchAllPortalUsers() {
  const users = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${PORTAL_URL}/rest/v1/usuarios?select=chapa,nombre&nombre=not.is.null&order=chapa.asc&limit=1000&offset=${offset}`, {
      headers: { apikey: PORTAL_ANON_KEY, authorization: `Bearer ${PORTAL_ANON_KEY}` }
    });
    if (!response.ok) throw new Error(`PortalEstibaVLC usuarios HTTP ${response.status}`);
    const page = await response.json();
    users.push(...page);
    if (page.length < 1000) break;
  }
  return users;
}

async function readAsset() {
  try {
    const parsed = JSON.parse(await fs.readFile(ASSET_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readStored(adminKey) {
  const response = await fetch(`${APP_CPE_URL}/rest/v1/app_cpe_bolsa_worker_directory?select=bolsa_chapa,display_name,source,first_seen_at&order=censo_number.asc`, {
    headers: supabaseAdminHeaders(adminKey)
  });
  if (!response.ok) throw new Error(`App CPE directorio HTTP ${response.status}`);
  return response.json();
}

export async function syncBolsaWorkerDirectory() {
  const adminKey = resolveSupabaseAdminKey();
  if (!adminKey) throw new Error("Falta la clave de Supabase para actualizar el directorio de bolsa.");
  const [portalUsers, stored, assetRows] = await Promise.all([fetchAllPortalUsers(), readStored(adminKey), readAsset()]);
  const directory = new Map();

  const remember = (row) => {
    const bolsaChapa = normalizeBolsaChapa(row.bolsa_chapa || row.chapa);
    const displayName = cleanName(row.display_name || row.nombre);
    if (!bolsaChapa || !displayName) return;
    const previous = directory.get(bolsaChapa);
    if (!previous || previous.source !== "manual" || row.source === "manual") {
      directory.set(bolsaChapa, {
        bolsa_chapa: bolsaChapa,
        display_name: displayName,
        source: row.source || row.fuente || "portalestibavlc",
        first_seen_at: row.first_seen_at || previous?.first_seen_at || new Date().toISOString()
      });
    }
  };

  assetRows.forEach(remember);
  stored.forEach(remember);
  portalUsers.forEach((row) => remember({ ...row, source: "portalestibavlc" }));

  const now = new Date().toISOString();
  const rows = [...directory.values()].sort((a, b) => Number(a.bolsa_chapa) - Number(b.bolsa_chapa));
  if (rows.length) {
    const response = await fetch(`${APP_CPE_URL}/rest/v1/app_cpe_bolsa_worker_directory?on_conflict=bolsa_chapa`, {
      method: "POST",
      headers: supabaseAdminHeaders(adminKey, {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      }),
      body: JSON.stringify(rows.map((row) => ({ ...row, last_seen_at: now, updated_at: now })))
    });
    if (!response.ok) throw new Error(`App CPE guardado del directorio HTTP ${response.status}: ${await response.text()}`);
  }

  const asset = rows.map((row) => ({
    chapa: row.bolsa_chapa,
    censo: Number(row.bolsa_chapa.slice(2)),
    nombre: row.display_name,
    fuente: row.source
  }));
  await fs.writeFile(ASSET_PATH, `${JSON.stringify(asset, null, 2)}\n`, "utf8");
  return { total: asset.length, assetPath: ASSET_PATH };
}
