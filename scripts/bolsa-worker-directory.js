import fs from "node:fs/promises";
import path from "node:path";
import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "./supabase-admin.js";

const APP_CPE_URL = String(process.env.CPE_SUPABASE_URL || "https://wvwdiywtlbffumshbboa.supabase.co").replace(/\/$/, "");
const PORTAL_URL = "https://icszzxkdxatfytpmoviq.supabase.co";
const PORTAL_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljc3p6eGtkeGF0Znl0cG1vdmlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2Mzk2NjUsImV4cCI6MjA3ODIxNTY2NX0.hmQWNB3sCyBh39gdNgQLjjlIvliwJje-OYf0kkPObVA";
const ASSET_PATH = path.resolve("assets", "bolsa-trabajadores.json");
const TURNO_ASSET_PATH = path.resolve("assets", "turno-trabajadores.json");
const INVALID_NAMES = /^(?:PERSONAL DE BOLSA|SIN NOMBRE(?: PUBLICADO)?|CHAPA\s+\d+|CERO)$/i;

export function normalizeBolsaChapa(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  if (/^80[0-9]{3}$/.test(digits)) return digits;
  if (/^[0-9]{1,3}$/.test(digits)) return `80${digits.padStart(3, "0")}`;
  return "";
}

export function normalizeTurnoChapa(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  return /^\d{5}$/.test(digits) && !/^80\d{3}$/.test(digits) ? digits : "";
}

function cleanName(value) {
  const name = String(value || "")
    .replace(/^\s*(?:bsa|nbs|dbs)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return name.length >= 2 && !INVALID_NAMES.test(name) ? name : "";
}

function nameQuality(value) {
  const name = cleanName(value);
  if (!name) return 0;
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length * 100) + name.length;
}

const SOURCE_PRIORITY = Object.freeze({ portalestibavlc: 0, manual: 1, app_cpe: 2 });

export function shouldReplaceBolsaName(previous, candidate) {
  if (!previous) return true;
  const previousSource = previous.source || previous.fuente || "manual";
  const candidateSource = candidate.source || candidate.fuente || "manual";
  if (previousSource === "app_cpe" && candidateSource !== "app_cpe") return false;
  if (candidateSource === "app_cpe" && previousSource !== "app_cpe") return true;
  if (previousSource === "manual" && candidateSource === "portalestibavlc") return false;
  if (candidateSource === "manual" && previousSource === "portalestibavlc") return true;
  const qualityDifference = nameQuality(candidate.display_name || candidate.nombre)
    - nameQuality(previous.display_name || previous.nombre);
  if (qualityDifference !== 0) return qualityDifference > 0;
  return (SOURCE_PRIORITY[candidateSource] || 0) > (SOURCE_PRIORITY[previousSource] || 0);
}

async function fetchAllPortalUsers() {
  const users = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${PORTAL_URL}/rest/v1/usuarios?select=chapa,nombre,activo&order=chapa.asc&limit=1000&offset=${offset}`, {
      headers: { apikey: PORTAL_ANON_KEY, authorization: `Bearer ${PORTAL_ANON_KEY}` }
    });
    if (!response.ok) throw new Error(`PortalEstibaVLC usuarios HTTP ${response.status}`);
    const page = await response.json();
    users.push(...page);
    if (page.length < 1000) break;
  }
  return users;
}

export function currentBolsaCensusChapas(users = []) {
  return new Set((Array.isArray(users) ? users : [])
    .filter((row) => row?.activo !== false)
    .map((row) => normalizeBolsaChapa(row?.chapa))
    .filter(Boolean));
}

async function deleteStaleDirectoryRows(adminKey, chapas) {
  if (!chapas.length) return;
  const filter = encodeURIComponent(`in.(${chapas.join(",")})`);
  const response = await fetch(`${APP_CPE_URL}/rest/v1/app_cpe_bolsa_worker_directory?bolsa_chapa=${filter}`, {
    method: "DELETE",
    headers: supabaseAdminHeaders(adminKey, { Prefer: "return=minimal" })
  });
  if (!response.ok) throw new Error(`App CPE borrado de chapas antiguas HTTP ${response.status}: ${await response.text()}`);
}

async function readAsset(assetPath = ASSET_PATH) {
  try {
    const parsed = JSON.parse(await fs.readFile(assetPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchAppCpeObservedWorkerNames(adminKey) {
  const workers = new Map();
  for (let offset = 0; ; offset += 250) {
    const response = await fetch(`${APP_CPE_URL}/rest/v1/app_cpe_noray_jornal_observations?select=part_detail,observed_at&order=updated_at.desc&limit=250&offset=${offset}`, {
      headers: supabaseAdminHeaders(adminKey)
    });
    if (!response.ok) throw new Error(`App CPE nombres de turno HTTP ${response.status}`);
    const page = await response.json();
    for (const observation of page) {
      for (const specialty of observation?.part_detail?.specialties || []) {
        for (const worker of specialty?.workers || []) {
          const chapa = normalizeTurnoChapa(worker?.code || worker?.chapa);
          const nombre = cleanName(worker?.name || worker?.nombre);
          if (!chapa || !nombre) continue;
          const previous = workers.get(chapa);
          if (!previous || nameQuality(nombre) > nameQuality(previous.display_name)) {
            workers.set(chapa, {
              worker_code: chapa,
              display_name: nombre,
              observed_at: observation.observed_at,
              source: "app_cpe"
            });
          }
        }
      }
    }
    if (page.length < 250) break;
  }
  return [...workers.values()];
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
  const [portalUsers, appCpeObserved, observedTurno, stored, assetRows, turnoAssetRows] = await Promise.all([
    fetchAllPortalUsers(),
    fetchAppCpeObservedNames(adminKey),
    fetchAppCpeObservedWorkerNames(adminKey),
    readStored(adminKey),
    readAsset(),
    readAsset(TURNO_ASSET_PATH)
  ]);
  const currentCensus = currentBolsaCensusChapas(portalUsers);
  const directory = new Map();

  const remember = (row) => {
    const source = row.source || row.fuente || "manual";
    const bolsaChapa = normalizeBolsaChapa(row.bolsa_chapa || row.chapa);
    const displayName = cleanName(row.display_name || row.nombre);
    if (!bolsaChapa || !currentCensus.has(bolsaChapa) || !displayName) return;
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
  portalUsers.forEach((row) => remember({ ...row, source: "portalestibavlc" }));
  appCpeObserved.forEach((row) => remember({
    chapa: row.worker_code,
    nombre: row.display_name,
    source: "app_cpe",
    first_seen_at: row.observed_at
  }));

  const staleChapas = stored
    .map((row) => normalizeBolsaChapa(row.bolsa_chapa))
    .filter((chapa) => chapa && !currentCensus.has(chapa));
  await deleteStaleDirectoryRows(adminKey, staleChapas);

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
  const turnoDirectory = new Map();
  const rememberTurno = (row) => {
    const chapa = normalizeTurnoChapa(row.worker_code || row.chapa);
    const nombre = cleanName(row.display_name || row.nombre);
    if (!chapa || !nombre) return;
    const candidate = { chapa, nombre, fuente: row.source || row.fuente || "manual" };
    const previous = turnoDirectory.get(chapa);
    if (shouldReplaceBolsaName(previous, candidate)) turnoDirectory.set(chapa, candidate);
  };
  turnoAssetRows.forEach(rememberTurno);
  portalUsers.forEach((row) => rememberTurno({ ...row, source: "portalestibavlc" }));
  observedTurno.forEach(rememberTurno);
  const turnoAsset = [...turnoDirectory.values()].sort((a, b) => Number(a.chapa) - Number(b.chapa));
  await fs.writeFile(TURNO_ASSET_PATH, `${JSON.stringify(turnoAsset, null, 2)}\n`, "utf8");
  return {
    total: asset.length,
    censusTotal: currentCensus.size,
    removedAsStale: staleChapas.length,
    turnoTotal: turnoAsset.length,
    observedInAppCpe: appCpeObserved.filter((row) => currentCensus.has(normalizeBolsaChapa(row.worker_code))).length,
    assetPath: ASSET_PATH,
    turnoAssetPath: TURNO_ASSET_PATH
  };
}
