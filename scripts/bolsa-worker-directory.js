import fs from "node:fs/promises";
import path from "node:path";
import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const APP_CPE_URL = String(process.env.CPE_SUPABASE_URL || "https://wvwdiywtlbffumshbboa.supabase.co").replace(/\/$/, "");
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

function nameQuality(value) {
  const name = cleanName(value);
  if (!name) return 0;
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length * 100) + name.length;
}

const SOURCE_PRIORITY = Object.freeze({ manual: 1, app_cpe: 2 });

export function shouldReplaceBolsaName(previous, candidate) {
  if (!previous) return true;
  const previousSource = previous.source || previous.fuente || "manual";
  const candidateSource = candidate.source || candidate.fuente || "manual";
  const qualityDifference = nameQuality(candidate.display_name || candidate.nombre)
    - nameQuality(previous.display_name || previous.nombre);
  if (qualityDifference !== 0) return qualityDifference > 0;
  return (SOURCE_PRIORITY[candidateSource] || 0) > (SOURCE_PRIORITY[previousSource] || 0);
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

async function fetchAppCpeObservedNames(adminKey) {
  const response = await fetch(`${APP_CPE_URL}/rest/v1/rpc/app_cpe_observed_bolsa_worker_names`, {
    method: "POST",
    headers: supabaseAdminHeaders(adminKey, { "Content-Type": "application/json" }),
    body: "{}"
  });
  if (!response.ok) throw new Error(`App CPE nombres observados HTTP ${response.status}`);
  return response.json();
}

export async function syncBolsaWorkerDirectory() {
  const adminKey = resolveSupabaseAdminKey();
  if (!adminKey) throw new Error("Falta la clave de Supabase para actualizar el directorio de bolsa.");
  const [appCpeObserved, stored, assetRows] = await Promise.all([
    fetchAppCpeObservedNames(adminKey),
    readStored(adminKey),
    readAsset()
  ]);
  const directory = new Map();

  const remember = (row) => {
    const source = row.source || row.fuente || "manual";
    if (source === "portalestibavlc") return;
    const bolsaChapa = normalizeBolsaChapa(row.bolsa_chapa || row.chapa);
    const displayName = cleanName(row.display_name || row.nombre);
    if (!bolsaChapa || !displayName) return;
    const previous = directory.get(bolsaChapa);
    if (shouldReplaceBolsaName(previous, row)) {
      directory.set(bolsaChapa, {
        bolsa_chapa: bolsaChapa,
        display_name: displayName,
        source,
        first_seen_at: row.first_seen_at || previous?.first_seen_at || new Date().toISOString()
      });
    }
  };

  assetRows.forEach(remember);
  stored.forEach(remember);
  appCpeObserved.forEach((row) => remember({
    chapa: row.worker_code,
    nombre: row.display_name,
    source: "app_cpe",
    first_seen_at: row.observed_at
  }));

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
  return {
    total: asset.length,
    observedInAppCpe: appCpeObserved.filter((row) => normalizeBolsaChapa(row.worker_code)).length,
    assetPath: ASSET_PATH
  };
}
