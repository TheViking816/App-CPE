import { createClient } from "@supabase/supabase-js";

const PORTAL_SUPABASE_URL = "https://icszzxkdxatfytpmoviq.supabase.co";
const PORTAL_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljc3p6eGtkeGF0Znl0cG1vdmlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2Mzk2NjUsImV4cCI6MjA3ODIxNTY2NX0.hmQWNB3sCyBh39gdNgQLjjlIvliwJje-OYf0kkPObVA";
const portalSupabase = createClient(PORTAL_SUPABASE_URL, PORTAL_SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export const JOURNEY_ORDER = ["02-08", "08-14", "14-20", "18-00", "19-01", "20-02"];
const SPECIALTY_ORDER = ["CAPATAZ", "SOBORDISTA", "CLASIFICADOR", "GRUAS", "CONDUCTOR 1A", "ESPECIALISTA"];

export function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

export function normalizeDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : text;
}

export function normalizeJourney(value) {
  const match = String(value || "").match(/(\d{1,2})\s*(?:-|A|a)\s*(\d{1,2})/);
  return match ? `${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : String(value || "Sin jornada").trim();
}

function companyInfo(value) {
  const normalized = normalizeText(value).toUpperCase();
  const aliases = [
    [/APM/, "APM", "APM TERMINALS VALENCIA, S.A."],
    [/CSP|COSCO/, "CSP", "CSP IBERIAN VALENCIA TERMINAL"],
    [/MEDITERRANEAN SHIPPING|\bMSC\b/, "MSC", "MSC TERMINAL VALENCIA"],
    [/VALENCIA TERMINAL EUROPA|\bVTEU\b|GRIMALDI/, "VTEU", "VALENCIA TERMINAL EUROPA"],
    [/SEVASA|CENTRO PORTUARIO|\bCPE\b/, "SEVASA", "SEVASA"],
    [/EUROPEA DE HANDLING|\bERH\b/, "ERH", "EUROPEA DE HANDLING"]
  ];
  const alias = aliases.find(([matcher]) => matcher.test(normalized));
  return alias ? { key: alias[1], name: alias[2] } : { key: normalized || "SIN EMPRESA", name: value || "Sin empresa" };
}

function specialtyKey(value) {
  return normalizeText(value || "Sin especialidad").toUpperCase()
    .replace(/^CONDUCTOR\s+DE\s+(1A|2A)$/, "CONDUCTOR $1")
    .replace(/^TRASTAINER(?:S)?(?:\s+RTT)?$/, "TRASTAINERS RTT")
    .replace(/^GRUA(?:S)?$/, "GRUAS");
}

function getJourney(map, date, journey) {
  const fecha = normalizeDate(date);
  const jornada = normalizeJourney(journey);
  const key = `${fecha}|${jornada}`;
  if (!map.has(key)) map.set(key, { key, fecha, jornada, companies: new Map() });
  return map.get(key);
}

function getGroup(journey, companyValue, block) {
  const company = companyInfo(companyValue);
  if (!journey.companies.has(company.key)) journey.companies.set(company.key, { ...company, groups: new Map() });
  const target = journey.companies.get(company.key);
  const ship = String(block.buque || "").trim();
  const hasShip = Boolean(ship && !["--", "-", "—", "SIN BARCO"].includes(ship.toUpperCase()));
  const name = hasShip ? ship : block.operacion || "Sin buque";
  const key = block.parte
    ? `parte:${normalizeText(block.parte).toUpperCase()}`
    : `grupo:${normalizeText(name).toUpperCase()}|${normalizeText(block.operacion).toUpperCase()}`;
  if (!target.groups.has(key)) {
    target.groups.set(key, { key, name, hasShip, parte: block.parte || "", operacion: block.operacion || "", muelle: block.muelle || "", specialties: new Map() });
  }
  return target.groups.get(key);
}

function addSpecialty(group, name, source, payload) {
  const key = specialtyKey(name);
  if (!group.specialties.has(key)) group.specialties.set(key, { key, name: String(name || "Sin especialidad").trim(), bolsa: [], turno: 0 });
  const specialty = group.specialties.get(key);
  if (source === "bolsa") specialty.bolsa.push(payload);
  else specialty.turno += Number(payload || 0);
}

function dedupeRows(rows) {
  const unique = new Map();
  rows.forEach((item) => {
    const key = [item.fecha, normalizeJourney(item.jornada), item.chapa, item.empresa, item.buque, item.parte, item.puesto]
      .map(normalizeText).join("|").toUpperCase();
    unique.set(key, item);
  });
  return [...unique.values()];
}

export function buildGeneralBoard(rows, snapshot) {
  const map = new Map();
  dedupeRows(rows || []).forEach((item) => {
    const journey = getJourney(map, item.fecha, item.jornada);
    const hasShip = item.buque && !["--", "-", "—"].includes(item.buque);
    const group = getGroup(journey, item.empresa, { ...item, operacion: hasShip ? "" : item.puesto });
    addSpecialty(group, item.puesto, "bolsa", item);
  });
  (snapshot?.jornadas || []).forEach((item) => {
    const journey = getJourney(map, item.fecha || snapshot.fecha, item.jornada);
    (item.bloques || []).forEach((block) => {
      const group = getGroup(journey, block.empresa, block);
      (block.especialidades || []).forEach((specialty) => addSpecialty(group, specialty.nombre, "turno", specialty.solicitudes));
    });
  });
  return [...map.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || JOURNEY_ORDER.indexOf(a.jornada) - JOURNEY_ORDER.indexOf(b.jornada));
}

export function boardCounts(journey) {
  const result = { bolsa: 0, turno: 0, total: 0, companies: journey?.companies.size || 0, ships: 0, specialties: 0 };
  const ships = new Set();
  const specialties = new Set();
  [...(journey?.companies.values() || [])].forEach((company) => [...company.groups.values()].forEach((group) => {
    if (group.hasShip) ships.add(`${company.key}|${normalizeText(group.name).toUpperCase()}`);
    [...group.specialties.values()].forEach((specialty) => {
      result.bolsa += specialty.bolsa.length;
      result.turno += specialty.turno;
      specialties.add(specialty.key);
    });
  }));
  result.total = result.bolsa + result.turno;
  result.ships = ships.size;
  result.specialties = specialties.size;
  return result;
}

export function sortGroups(groups) {
  return [...groups].sort((a, b) => {
    const order = (group) => group.hasShip ? 0 : /^CONDUCTOR(?:\s+DE)?\s+1A$/.test(normalizeText(group.name || group.operacion).toUpperCase()) ? 2 : 1;
    return order(a) - order(b);
  });
}

export function sortSpecialties(items) {
  return [...items].sort((a, b) => {
    const ai = SPECIALTY_ORDER.indexOf(a.key);
    const bi = SPECIALTY_ORDER.indexOf(b.key);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.name.localeCompare(b.name, "es");
  });
}

export function defaultJourneyKey(journeys) {
  const now = new Date();
  const hour = now.getHours();
  const preferred = hour < 8 && hour >= 2 ? "02-08" : hour < 14 && hour >= 8 ? "08-14" : hour < 20 && hour >= 14 ? "14-20" : "20-02";
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return journeys.find((item) => item.fecha === today && item.jornada === preferred)?.key || journeys.find((item) => item.fecha === today)?.key || journeys[0]?.key || "";
}

export async function fetchGeneralBoard() {
  const { data: snapshotRow, error: snapshotError } = await portalSupabase.from("contratacion_turno_snapshot").select("payload, updated_at").eq("id", "latest").maybeSingle();
  if (snapshotError || !snapshotRow?.payload) throw snapshotError || new Error("No hay contratación de Turno");
  const { data: currentRows, error: currentError } = await portalSupabase.from("tablon_actual").select("id,chapa,empresa,buque,parte,puesto,jornada,fecha").order("id");
  if (currentError) throw currentError;
  const dates = [...new Set([...(snapshotRow.payload.jornadas || []).map((item) => normalizeDate(item.fecha || snapshotRow.payload.fecha)), ...(currentRows || []).map((item) => normalizeDate(item.fecha))].filter(Boolean))];
  const historical = await Promise.all(dates.map((date) => portalSupabase.from("jornales").select("id,chapa,empresa,buque,parte,puesto,jornada,fecha").eq("fecha", date).order("id")));
  const failed = historical.find((result) => result.error);
  if (failed?.error) throw failed.error;
  return {
    journeys: buildGeneralBoard([...historical.flatMap((result) => result.data || []), ...(currentRows || [])], snapshotRow.payload),
    updatedAt: snapshotRow.payload.generatedAt || snapshotRow.updated_at
  };
}

export function dateLabel(value) {
  const match = normalizeDate(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value || "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return `${["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][date.getDay()]} ${match[3]}/${match[2]}`;
}

export function companyLogo(name) {
  const base = "https://portal-estiba-vlc.vercel.app/assets/empresas";
  if (/APM/i.test(name)) return `${base}/apm.jpeg`;
  if (/CSP/i.test(name)) return `${base}/csp.jpeg`;
  if (/MSC|MEDITERRANEAN/i.test(name)) return `${base}/msc.jpeg`;
  if (/TRASMED/i.test(name)) return `${base}/trasmed.png`;
  if (/SEVASA|CPE/i.test(name)) return `${base}/cpe.jpg`;
  return "";
}

export function groupImage(group) {
  const base = "https://portal-estiba-vlc.vercel.app/assets";
  const normalized = normalizeText(group.name || group.operacion).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (/^gruas?$/.test(normalized)) return `${base}/maquinas/gruas.jpg`;
  if (/^(rtts?|trastainers?)$/.test(normalized)) return `${base}/maquinas/trastainer.jpg`;
  if (/^(conts?|containers?|containeras?)$/.test(normalized)) return `${base}/maquinas/containeras.jpg`;
  return group.hasShip ? `${base}/barcos/${normalized}.jpg` : "";
}
