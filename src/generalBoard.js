import { createClient } from "@supabase/supabase-js";

const PORTAL_SUPABASE_URL = "https://icszzxkdxatfytpmoviq.supabase.co";
const PORTAL_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljc3p6eGtkeGF0Znl0cG1vdmlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2Mzk2NjUsImV4cCI6MjA3ODIxNTY2NX0.hmQWNB3sCyBh39gdNgQLjjlIvliwJje-OYf0kkPObVA";
const portalSupabase = createClient(PORTAL_SUPABASE_URL, PORTAL_SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const BOARD_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSTtbkA94xqjf81lsR7bLKKtyES2YBDKs8J2T4UrSEan7e5Z_eaptShCA78R1wqUyYyASJxmHj3gDnY/pub?output=csv&gid=1388412839";
const CONTRACTING_HOLIDAYS = new Set([
  "01/01/2026", "06/01/2026", "22/01/2026", "19/03/2026", "03/04/2026", "06/04/2026",
  "13/04/2026", "01/05/2026", "24/06/2026", "15/08/2026", "09/10/2026", "12/10/2026",
  "01/11/2026", "06/12/2026", "08/12/2026", "25/12/2026",
  "01/01/2027", "06/01/2027", "02/04/2027", "05/04/2027", "01/05/2027", "09/10/2027",
  "12/10/2027", "01/11/2027", "06/12/2027", "08/12/2027", "25/12/2027"
]);
let boardSyncInFlight = null;

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

function madridParts(now = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now).map(({ type, value }) => [type, value]));
}

function offsetDate(parts, offset, format = "iso") {
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offset, 12));
  return new Intl.DateTimeFormat(format === "iso" ? "en-CA" : "en-GB", format === "iso"
    ? { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }
    : { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function madridTodayIso(now = new Date()) {
  return offsetDate(madridParts(now), 0);
}

export function expectedContractingSelection(now = new Date()) {
  const parts = madridParts(now);
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const specialEve = parts.weekday === "Sat" || CONTRACTING_HOLIDAYS.has(offsetDate(parts, 1, "es"));
  let offset = 0;
  let journey = "02-08";
  if (minute >= 7 * 60) journey = "08-14";
  if (specialEve && minute >= 11 * 60 + 30) journey = "14-20";
  if (specialEve && minute >= 13 * 60) {
    offset = 1;
    journey = "02-08";
  } else if (!specialEve && minute >= 14 * 60 + 30) journey = "20-02";
  else if (!specialEve && minute >= 12 * 60) journey = "14-20";
  const date = offsetDate(parts, offset);
  return { key: `${date}|${journey}`, date, journey };
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { result.push(current.trim()); current = ""; }
    else current += char;
  }
  result.push(current.trim());
  return result;
}

function parseBoardCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((value) => value.trim().replace(/^"|"$/g, "").toLowerCase());
  const indexOf = (...names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0);
  const columns = {
    date: indexOf("fecha", "fc"), journey: indexOf("jornada", "cshorario", "horario"),
    company: indexOf("empresa", "nomcliabr", "cliente"), part: indexOf("parte"), ship: indexOf("buque"),
    posts: { T: indexOf("t"), TC: indexOf("tc"), C1: indexOf("c1"), B: indexOf("b"), E: indexOf("e") }
  };
  const postNames = { T: "Trincador", TC: "Trincador de Coches", C1: "Conductor de 1a", B: "Conductor de 2a", E: "Especialista" };
  const rows = [];
  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line).map((value) => value.trim().replace(/^"|"$/g, ""));
    const rawDate = values[columns.date] || "";
    if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(rawDate)) continue;
    const journey = normalizeJourney(values[columns.journey]);
    if (!JOURNEY_ORDER.includes(journey)) continue;
    const [day, month, rawYear] = rawDate.split("/");
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    for (const [code, index] of Object.entries(columns.posts)) {
      const chapa = values[index]?.trim();
      if (!chapa || !Number.isFinite(Number(chapa)) || Number(chapa) <= 0) continue;
      rows.push({ fecha: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`, jornada, chapa,
        puesto: postNames[code], empresa: values[columns.company] || "", buque: values[columns.ship] || "--", parte: values[columns.part] || "1" });
    }
  }
  return rows;
}

async function syncBoardFromCsv() {
  if (boardSyncInFlight) return boardSyncInFlight;
  boardSyncInFlight = (async () => {
    let response;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      response = await fetch(BOARD_CSV_URL, { cache: "no-store" }).catch(() => null);
      if (response?.ok) break;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    }
    if (!response?.ok) return { success: false, journeys: [] };
    const rows = parseBoardCsv(await response.text()).filter((row) => row.fecha >= madridTodayIso());
    if (!rows.length) return { success: false, journeys: [] };
    return { success: true, rows, journeys: [...new Set(rows.map((row) => `${row.fecha}|${row.jornada}`))] };
  })();
  try { return await boardSyncInFlight; } finally { boardSyncInFlight = null; }
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
  return expectedContractingSelection().key;
}

export async function fetchGeneralBoard() {
  const expected = expectedContractingSelection();
  const todayIso = madridTodayIso();
  const syncResult = await syncBoardFromCsv().catch(() => ({ success: false, journeys: [], rows: [] }));
  const trustedKeys = new Set(syncResult.success ? syncResult.journeys : []);
  const { data: snapshotRow, error: snapshotError } = await portalSupabase.from("contratacion_turno_snapshot").select("payload, updated_at").eq("id", "latest").maybeSingle();
  if (snapshotError || !snapshotRow?.payload) throw snapshotError || new Error("No hay contratación de Turno");
  const { data: currentRows, error: currentError } = await portalSupabase.from("tablon_actual").select("id,chapa,empresa,buque,parte,puesto,jornada,fecha").order("id");
  if (currentError) throw currentError;
  const snapshot = {
    ...snapshotRow.payload,
    jornadas: (snapshotRow.payload.jornadas || []).filter((item) => normalizeDate(item.fecha || snapshotRow.payload.fecha) >= todayIso)
  };
  const currentAndFutureRows = (currentRows || []).filter((item) => normalizeDate(item.fecha) >= todayIso);
  const dates = [...new Set([...(snapshot.jornadas || []).map((item) => normalizeDate(item.fecha || snapshot.fecha)), ...currentAndFutureRows.map((item) => normalizeDate(item.fecha))].filter(Boolean))];
  const historical = await Promise.all(dates.map((date) => portalSupabase.from("jornales").select("id,chapa,empresa,buque,parte,puesto,jornada,fecha").eq("fecha", date).order("id")));
  const failed = historical.find((result) => result.error);
  if (failed?.error) throw failed.error;
  const storedRows = dedupeRows([...historical.flatMap((result) => result.data || []), ...currentAndFutureRows]);
  const storedKeys = new Set(storedRows.map((row) => `${normalizeDate(row.fecha)}|${normalizeJourney(row.jornada)}`));
  const expectedBolsaAvailable = trustedKeys.has(expected.key) || storedKeys.has(expected.key);
  const bolsaRows = dedupeRows([
    ...storedRows,
    ...(syncResult.success ? syncResult.rows || [] : [])
  ]).filter((row) => normalizeDate(row.fecha) >= todayIso);
  return {
    journeys: buildGeneralBoard(bolsaRows, snapshot),
    expectedKey: expected.key,
    bolsaPending: !expectedBolsaAvailable,
    updatedAt: snapshot.generatedAt || snapshotRow.updated_at
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
