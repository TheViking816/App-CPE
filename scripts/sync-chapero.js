import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDataDir = path.join(rootDir, "public", "data");
const privateDataDir = path.join(rootDir, "data");

const chaperoUrl = process.env.CPE_CHAPERO_URL
  || "https://portal.cpevalencia.com/Noray/Chapero.asp?mode=GWT&devType=Desktop&device=Desktop&browser=Chrome&os=Windows&rd=744375419261120260702080606";
const headless = String(process.env.CPE_HEADLESS || "true").toLowerCase() !== "false";
const supabaseUrl = process.env.CPE_SUPABASE_URL;
const supabaseServiceRole = process.env.CPE_SUPABASE_SERVICE_ROLE;
const defaultProjectRef = "wvwdiywtlbffumshbboa";

const STATUS_LABELS = {
  contratado: "Contratado",
  anticipado: "Anticipado",
  nocontratado: "No contratado",
  falta: "No disponible",
  excepcion: "Con excepcion",
  doble: "Doble"
};

function resolveSupabaseUrl(value) {
  const firstLine = String(value || "").trim().split(/\s+/)[0] || defaultProjectRef;
  if (/^https?:\/\//i.test(firstLine)) return firstLine.replace(/\/$/, "");
  if (/^[a-z0-9]{20}$/i.test(firstLine)) return `https://${firstLine}.supabase.co`;
  return `https://${defaultProjectRef}.supabase.co`;
}

function normalizeChaperoChapa(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 5) return digits.slice(-5);
  return `7${digits.padStart(4, "0")}`;
}

function parseHeader(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const pageDate = lines.find((line) => /^\d{2}\/\d{2}\/\d{4}\s+-\s+\d{2}:\d{2}/.test(line)) || "";
  const jornadaLine = lines.find((line) => /ULTIMA JORNADA CONTRATADA/i.test(line)) || "";
  const jornadaMatch = jornadaLine.match(/(\d{2}\/\d{2}\/\d{2})\s+-\s+DE\s+(\d{2})\s+A\s+(\d{2})\s+H/i);

  return {
    pageDate,
    jornadaText: jornadaLine.replace(/\s+/g, " "),
    jornadaDate: jornadaMatch?.[1] || null,
    fromHour: jornadaMatch?.[2] || null,
    toHour: jornadaMatch?.[3] || null,
    shiftKey: jornadaMatch && ["20", "02"].includes(jornadaMatch[2]) ? "NOC" : "LAB"
  };
}

async function upsertSupabaseSnapshot(snapshot) {
  if (!supabaseServiceRole) return;

  const response = await fetch(`${resolveSupabaseUrl(supabaseUrl)}/rest/v1/app_cpe_chapero_snapshots?on_conflict=snapshot_key`, {
    method: "POST",
    headers: {
      "apikey": supabaseServiceRole,
      "Authorization": `Bearer ${supabaseServiceRole}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      snapshot_key: "latest",
      source: snapshot.source,
      page_date: snapshot.pageDate,
      jornada_text: snapshot.jornadaText,
      jornada_date: snapshot.jornadaDate,
      from_hour: snapshot.fromHour,
      to_hour: snapshot.toHour,
      shift_key: snapshot.shiftKey,
      summary: snapshot.summary,
      workers: snapshot.workers,
      updated_at: snapshot.updatedAt
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
}

async function main() {
  await fs.mkdir(publicDataDir, { recursive: true });
  await fs.mkdir(privateDataDir, { recursive: true });

  const browser = await chromium.launch({ channel: "msedge", headless })
    .catch(() => chromium.launch({ headless }));
  const page = await browser.newPage({
    viewport: { width: 1500, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
  });

  try {
    const response = await page.goto(chaperoUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (!response || response.status() >= 400) {
      throw new Error(`No se pudo abrir Chapero. HTTP ${response ? response.status() : "sin respuesta"}`);
    }

    const snapshot = await page.evaluate((statusLabels) => {
      function normalizeChaperoChapa(raw) {
        const digits = String(raw || "").replace(/\D/g, "");
        if (!digits) return "";
        if (digits.length >= 5) return digits.slice(-5);
        return `7${digits.padStart(4, "0")}`;
      }

      function parseHeader(text) {
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const pageDate = lines.find((line) => /^\d{2}\/\d{2}\/\d{4}\s+-\s+\d{2}:\d{2}/.test(line)) || "";
        const jornadaLine = lines.find((line) => /ULTIMA JORNADA CONTRATADA/i.test(line)) || "";
        const jornadaMatch = jornadaLine.match(/(\d{2}\/\d{2}\/\d{2})\s+-\s+DE\s+(\d{2})\s+A\s+(\d{2})\s+H/i);
        return {
          pageDate,
          jornadaText: jornadaLine.replace(/\s+/g, " "),
          jornadaDate: jornadaMatch?.[1] || null,
          fromHour: jornadaMatch?.[2] || null,
          toHour: jornadaMatch?.[3] || null,
          shiftKey: jornadaMatch && ["20", "02"].includes(jornadaMatch[2]) ? "NOC" : "LAB"
        };
      }

      const text = document.body.innerText;
      const header = parseHeader(text);
      const statusClasses = new Set(Object.keys(statusLabels));
      const workers = [...document.querySelectorAll("span")]
        .map((span) => ({
          rawChapa: span.textContent.trim(),
          status: String(span.className || "").trim()
        }))
        .filter((item) => /^\d{4,5}$/.test(item.rawChapa) && statusClasses.has(item.status))
        .map((item) => ({
          rawChapa: item.rawChapa,
          chapa: normalizeChaperoChapa(item.rawChapa),
          status: item.status,
          label: statusLabels[item.status]
        }));

      const summary = workers.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {});

      return {
        source: location.href,
        updatedAt: new Date().toISOString(),
        ...header,
        summary,
        workers
      };
    }, STATUS_LABELS);

    if (!snapshot.workers.length) {
      await page.screenshot({ path: path.join(privateDataDir, "chapero-error.png"), fullPage: true });
      throw new Error("No se encontraron chapas en Chapero.");
    }

    const payload = JSON.stringify(snapshot, null, 2);
    await fs.writeFile(path.join(publicDataDir, "chapero-snapshot.json"), payload, "utf8");
    await fs.writeFile(path.join(privateDataDir, "chapero-snapshot.json"), payload, "utf8");

    if (supabaseServiceRole) await upsertSupabaseSnapshot(snapshot);
    console.log(`OK: Chapero ${snapshot.pageDate} - ${snapshot.workers.length} chapas`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Error desconocido");
  process.exit(1);
});
