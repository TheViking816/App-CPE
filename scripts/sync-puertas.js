import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDataDir = path.join(rootDir, "public", "data");
const privateDataDir = path.join(rootDir, "data");
const diagnosticFileName = "puertas-sync-status.json";

const puertasUrl = process.env.CPE_PUERTAS_URL
  || "https://portal.cpevalencia.com/Noray/Puertas.asp?mode=GWT&devType=Desktop&device=Desktop&browser=Chrome&os=Windows&rd=316781698261120260630144003";
const headless = String(process.env.CPE_HEADLESS || "true").toLowerCase() !== "false";
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

async function upsertSupabaseSnapshot(parsed) {
  const response = await fetch(`${resolveSupabaseUrl(supabaseUrl)}/rest/v1/app_cpe_door_snapshots?on_conflict=specialty`, {
    method: "POST",
    headers: {
      "apikey": supabaseServiceRole,
      "Authorization": `Bearer ${supabaseServiceRole}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      specialty: parsed.specialty,
      source: parsed.source,
      doors: parsed.doors,
      raw_columns: parsed.rawColumns,
      updated_at: parsed.updatedAt
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
}

const specialtyRows = [
  { code: "11", name: "CONDUCTOR 1a", snapshotName: "CONDUCTOR 1a", mode: "turno" },
  { code: "12", name: "CONDUCTOR 2a", snapshotName: "CONDUCTOR 2a", mode: "turno" },
  { code: "22", name: "TRASTAINERS RTT", snapshotName: "TRASTAINERS RTT", mode: "turno" },
  { code: "11", name: "CONDUCTOR 1a", snapshotName: "POL. CONDUCTOR 1a", mode: "polivalencia" },
  { code: "12", name: "CONDUCTOR 2a", snapshotName: "POL. CONDUCTOR 2a", mode: "polivalencia" },
  { code: "03", name: "ESPECIALISTA", snapshotName: "POL. ESPECIALISTA", mode: "polivalencia" },
  { code: "10", name: "TRINCADOR", snapshotName: "POL. TRINCADOR", mode: "polivalencia" },
  { code: "09", name: "TRINCA COCHES", snapshotName: "POL. TRINCA COCHES", mode: "polivalencia" }
];

function parseSpecialtyFromText(text, row) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const escapedName = row.name.replace(/\s+/g, "\\s+");
  const pattern = new RegExp(`(?:^|\\s)${row.code}\\s+${escapedName}\\s+(\\d{5})\\s+(\\d{5})\\s+(\\d{5})\\s+(\\d{5})\\s+(\\d{5})\\s+(\\d{5})\\s+(\\d{5})\\s+(\\d{5})\\s+(\\d{5})\\s+(\\d{5})(?:\\s|$)`, "i");
  const match = normalized.match(pattern);

  const values = match
    ? match.slice(1).map(Number)
    : parseSpecialtyValuesFromLines(text, row);

  if (!values) return null;

  return {
    source: puertasUrl,
    specialty: row.snapshotName,
    updatedAt: new Date().toISOString(),
    doors: row.mode === "polivalencia"
      ? [
        { key: "LAB", label: "Diurna", raw: values[3], dayType: "laborable", shift: "LAB" },
        { key: "NOC", label: "Super", raw: values[4], dayType: "laborable", shift: "NOC" },
        { key: "NOC-FES", label: "Super festiva", raw: values[8], dayType: "festivo", shift: "NOC-FES" },
        { key: "FES", label: "Diurna festiva", raw: values[9], dayType: "festivo", shift: "FES" }
      ]
      : [
        { key: "LAB", label: "Diurna", raw: values[0], dayType: "laborable", shift: "LAB" },
        { key: "NOC", label: "Super", raw: values[1], dayType: "laborable", shift: "NOC" },
        { key: "NOC-FES", label: "Super festiva", raw: values[6], dayType: "festivo", shift: "NOC-FES" },
        { key: "FES", label: "Diurna festiva", raw: values[7], dayType: "festivo", shift: "FES" }
      ],
    rawColumns: {
      labHoy: values[0],
      super: values[1],
      labSigDia: values[2],
      rawCol4: values[3],
      rawCol5: values[4],
      rawCol6: values[5],
      festivoSuper: values[6],
      festivoDiurno: values[7],
      rawCol9: values[8],
      rawCol10: values[9]
    }
  };
}

function parseSpecialtyValuesFromLines(text, row) {
  const targetName = row.name.replace(/\s+/g, " ").trim().toUpperCase();
  const line = text.split(/\r?\n/)
    .find((candidate) => {
      const normalized = candidate.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
      return normalized.startsWith(`${row.code} ${targetName} `);
    });

  if (!line) return null;

  const cells = line.split("\t").map((cell) => cell.replace(/\u00a0/g, " ").trim());
  const valueCells = cells.slice(2);
  if (valueCells.length < 10) return null;

  const values = valueCells.slice(0, 10).map((cell) => {
    const digits = cell.replace(/\D/g, "");
    return digits ? Number(digits) : null;
  });

  return values.some((value) => value !== null) ? values : null;
}

function parseSpecialtiesFromText(text) {
  return specialtyRows.map((row) => parseSpecialtyFromText(text, row)).filter(Boolean);
}

async function main() {
  await fs.mkdir(publicDataDir, { recursive: true });
  await fs.mkdir(privateDataDir, { recursive: true });

  const browser = await chromium.launch({ channel: "msedge", headless })
    .catch(() => chromium.launch({ headless }));
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
  });

  try {
    const response = await page.goto(puertasUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (!response || response.status() >= 400) {
      throw new Error(`No se pudo abrir Puertas. HTTP ${response ? response.status() : "sin respuesta"}`);
    }
    await page.locator("body").waitFor({ state: "visible", timeout: 15000 });

    const text = await page.locator("body").innerText({ timeout: 10000 });
    await fs.writeFile(path.join(privateDataDir, "raw-puertas.txt"), text, "utf8");

    const parsedSnapshots = parseSpecialtiesFromText(text);
    if (!parsedSnapshots.length) {
      await page.screenshot({ path: path.join(privateDataDir, "puertas-error.png"), fullPage: true });
      await fs.writeFile(path.join(publicDataDir, diagnosticFileName), JSON.stringify({
        ok: false,
        stage: "parse",
        updatedAt: new Date().toISOString(),
        source: puertasUrl,
        message: "No se pudieron encontrar filas de especialidades en Puertas.",
        preview: text.slice(0, 800)
      }, null, 2), "utf8");
      throw new Error("No se pudieron encontrar filas de especialidades en Puertas.");
    }

    const parsed = parsedSnapshots.find((snapshot) => snapshot.specialty === "CONDUCTOR 1a") || parsedSnapshots[0];
    const payload = JSON.stringify(parsed, null, 2);
    await fs.writeFile(path.join(publicDataDir, "puertas-conductor-1a.json"), payload, "utf8");
    await fs.writeFile(path.join(privateDataDir, "puertas-conductor-1a.json"), payload, "utf8");
    await fs.writeFile(path.join(publicDataDir, "puertas-snapshots.json"), JSON.stringify(parsedSnapshots, null, 2), "utf8");
    await fs.writeFile(path.join(privateDataDir, "puertas-snapshots.json"), JSON.stringify(parsedSnapshots, null, 2), "utf8");
    await fs.writeFile(path.join(publicDataDir, diagnosticFileName), JSON.stringify({
      ok: true,
      stage: "parsed",
      updatedAt: parsed.updatedAt,
      source: parsed.source,
      supabaseConfigured: Boolean(supabaseUrl && supabaseServiceRole),
      specialties: parsedSnapshots.map((snapshot) => snapshot.specialty),
      doors: parsed.doors.map((door) => ({ key: door.key, raw: door.raw }))
    }, null, 2), "utf8");

    if (supabaseUrl && supabaseServiceRole) {
      try {
        for (const snapshot of parsedSnapshots) {
          await upsertSupabaseSnapshot(snapshot);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error desconocido";
        await fs.writeFile(path.join(publicDataDir, diagnosticFileName), JSON.stringify({
          ok: false,
          stage: "supabase",
          updatedAt: new Date().toISOString(),
          source: parsed.source,
          supabaseConfigured: true,
          specialties: parsedSnapshots.map((snapshot) => snapshot.specialty),
          doors: parsed.doors.map((door) => ({ key: door.key, raw: door.raw })),
          message
        }, null, 2), "utf8");
        throw new Error(`Puertas guardadas en JSON, pero fallo Supabase: ${message}`);
      }

      await fs.writeFile(path.join(publicDataDir, diagnosticFileName), JSON.stringify({
        ok: true,
        stage: "supabase",
        updatedAt: parsed.updatedAt,
        source: parsed.source,
        supabaseConfigured: true,
        specialties: parsedSnapshots.map((snapshot) => snapshot.specialty),
        doors: parsed.doors.map((door) => ({ key: door.key, raw: door.raw }))
      }, null, 2), "utf8");
    }

    console.log(`OK: ${parsedSnapshots.map((snapshot) => snapshot.specialty).join(", ")}`);
  } finally {
    await browser.close();
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : "Error desconocido";
  await fs.mkdir(publicDataDir, { recursive: true });
  await fs.writeFile(path.join(publicDataDir, diagnosticFileName), JSON.stringify({
    ok: false,
    stage: "load",
    updatedAt: new Date().toISOString(),
    source: puertasUrl,
    message
  }, null, 2), "utf8").catch(() => {});
  console.error(message);
  process.exit(1);
});
