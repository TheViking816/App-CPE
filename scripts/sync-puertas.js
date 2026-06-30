import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDataDir = path.join(rootDir, "public", "data");
const privateDataDir = path.join(rootDir, "data");

const puertasUrl = process.env.CPE_PUERTAS_URL
  || "https://portal.cpevalencia.com/Noray/Puertas.asp?mode=GWT&devType=Desktop&device=Desktop&browser=Chrome&os=Windows&rd=316778848261120260630132522";
const headless = String(process.env.CPE_HEADLESS || "true").toLowerCase() !== "false";
const supabaseUrl = process.env.CPE_SUPABASE_URL;
const supabaseServiceRole = process.env.CPE_SUPABASE_SERVICE_ROLE;

function parseConductor1aFromText(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/(?:^|\s)11\s+CONDUCTOR\s+1a\s+(\d{5})\s+(\d{5})\s+(\d{5})\s+(\d{5})\s+(\d{5})\s+(\d{5})\s+(\d{5})\s+(\d{5})\s+(\d{5})\s+(\d{5})(?:\s|$)/i);

  if (!match) return null;

  const values = match.slice(1).map(Number);

  return {
    source: puertasUrl,
    specialty: "CONDUCTOR 1a",
    updatedAt: new Date().toISOString(),
    doors: [
      { key: "LAB", label: "LAB", raw: values[0], turn: "Laborable" },
      { key: "NOC", label: "NOC", raw: values[1], turn: "Laborable super/noche" },
      { key: "LAB-SIG", label: "LAB SIG.", raw: values[2], turn: "Laborable siguiente dia" },
      { key: "POL-LAB", label: "POL LAB", raw: values[3], turn: "Polivalencia laborable" },
      { key: "POL-NOC", label: "POL NOC", raw: values[4], turn: "Polivalencia super/noche" },
      { key: "POL-LAB-SIG", label: "POL SIG.", raw: values[5], turn: "Polivalencia siguiente dia" },
      { key: "NOC-FES", label: "NOC-FES", raw: values[6], turn: "Festivo super/noche" },
      { key: "FES", label: "FES", raw: values[7], turn: "Festivo diurno" },
      { key: "POL-NOC-FES", label: "POL NOC-FES", raw: values[8], turn: "Festivo polivalencia super" },
      { key: "POL-FES", label: "POL FES", raw: values[9], turn: "Festivo polivalencia diurno" }
    ],
    rawColumns: {
      labHoy: values[0],
      super: values[1],
      labSigDia: values[2],
      polivalenciaLabHoy: values[3],
      polivalenciaSuper: values[4],
      polivalenciaLabSigDia: values[5],
      festivoSuper: values[6],
      festivoDiurno: values[7],
      festivoPolivalenciaSuper: values[8],
      festivoPolivalenciaDiurno: values[9]
    }
  };
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
    const response = await page.goto(puertasUrl, { waitUntil: "networkidle", timeout: 30000 });
    if (!response || response.status() >= 400) {
      throw new Error(`No se pudo abrir Puertas. HTTP ${response ? response.status() : "sin respuesta"}`);
    }

    const text = await page.locator("body").innerText({ timeout: 10000 });
    await fs.writeFile(path.join(privateDataDir, "raw-puertas.txt"), text, "utf8");

    const parsed = parseConductor1aFromText(text);
    if (!parsed) {
      await page.screenshot({ path: path.join(privateDataDir, "puertas-error.png"), fullPage: true });
      throw new Error("No se pudo encontrar la fila CONDUCTOR 1a en Puertas.");
    }

    const payload = JSON.stringify(parsed, null, 2);
    await fs.writeFile(path.join(publicDataDir, "puertas-conductor-1a.json"), payload, "utf8");
    await fs.writeFile(path.join(privateDataDir, "puertas-conductor-1a.json"), payload, "utf8");

    if (supabaseUrl && supabaseServiceRole) {
      const supabase = createClient(supabaseUrl, supabaseServiceRole, {
        auth: { persistSession: false }
      });

      const { error } = await supabase
        .from("app_cpe_door_snapshots")
        .insert({
          specialty: parsed.specialty,
          source: parsed.source,
          doors: parsed.doors,
          raw_columns: parsed.rawColumns,
          updated_at: parsed.updatedAt
        });

      if (error) {
        throw new Error(`Puertas guardadas en JSON, pero fallo Supabase: ${error.message}`);
      }
    }

    console.log(`OK: ${parsed.specialty}`);
    console.log(parsed.doors.map((door) => `${door.key}=${door.raw}`).join(" "));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
