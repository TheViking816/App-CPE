import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "data");

const portalUrl = process.env.CPE_PORTAL_URL || "https://portal.cpevalencia.com/#User";
const username = process.env.CPE_USER;
const password = process.env.CPE_PASSWORD;
const headless = String(process.env.CPE_HEADLESS || "true").toLowerCase() !== "false";

if (!username || !password) {
  console.error("Faltan CPE_USER o CPE_PASSWORD en variables de entorno.");
  console.error("Ejemplo PowerShell:");
  console.error('$env:CPE_USER="72683"; $env:CPE_PASSWORD="..." ; npm run sync:cpe');
  process.exit(1);
}

function parseConductor1a(pageText) {
  const normalized = pageText.replace(/\r/g, "");
  const headerMatch = normalized.match(/CONDUCTOR\s+1a\s+\(censo:\s*(\d+)\)([\s\S]*?)(?:Disponibles:\s*\d+|CONDUCTOR\s+2a|\n\s*12\s+)/i);
  if (!headerMatch) {
    return null;
  }

  const block = headerMatch[0];
  const doors = {};
  for (const match of block.matchAll(/\b(LAB|FES|NOC|NOC-FES)\s+(\d{5})\b/g)) {
    doors[match[1]] = Number(match[2]);
  }

  const numbers = block.match(/\b\d{4}\b/g) || [];
  const doorValues = new Set(Object.values(doors).map((value) => String(value).slice(-4)));
  const censo = numbers
    .map(Number)
    .filter((value) => value >= 1000 && value <= 9999)
    .filter((value) => !doorValues.has(String(value)));

  return {
    specialty: "CONDUCTOR 1a",
    expectedSize: Number(headerMatch[1]),
    doors,
    censo,
    parsedAt: new Date().toISOString()
  };
}

async function fillFirstVisible(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.fill(value);
      return true;
    }
  }
  return false;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

  try {
    await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    const userFilled = await fillFirstVisible(page, [
      'input[name*="user" i]',
      'input[id*="user" i]',
      'input[type="text"]',
      'input:not([type])'
    ], username);

    const passwordFilled = await fillFirstVisible(page, [
      'input[type="password"]',
      'input[name*="pass" i]',
      'input[id*="pass" i]'
    ], password);

    if (!userFilled || !passwordFilled) {
      throw new Error("No se han encontrado los campos de usuario/contraseña.");
    }

    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => null),
      page.getByRole("button", { name: /iniciar sesión/i }).click()
        .catch(() => page.locator('input[type="submit"], button').last().click())
    ]);

    await page.getByText("Chapero por especialidades", { exact: true }).click({ timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(1500);

    const text = await page.locator("body").innerText();
    await fs.writeFile(path.join(outputDir, "raw-chapero.txt"), text, "utf8");

    const parsed = parseConductor1a(text);
    if (!parsed) {
      await page.screenshot({ path: path.join(outputDir, "sync-error.png"), fullPage: true });
      throw new Error("No se pudo parsear CONDUCTOR 1a desde el texto de la página.");
    }

    await fs.writeFile(path.join(outputDir, "conductor-1a.json"), JSON.stringify(parsed, null, 2), "utf8");
    console.log(`OK: ${parsed.specialty}, ${parsed.censo.length}/${parsed.expectedSize} chapas.`);
    console.log(`Guardado: ${path.join(outputDir, "conductor-1a.json")}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
