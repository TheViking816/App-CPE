import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const censoSourcePath = path.join(rootDir, "src", "censo.js");
const outputDir = path.join(rootDir, "data", "censos");
const profileDir = path.resolve(process.env.CPE_PORTAL_PROFILE_DIR || path.join(rootDir, "data", "portal-oficial-chrome-profile"));
const portalUrl = "https://portal.cpevalencia.com/#User";
const portalUser = String(process.env.CPE_PORTAL_USER || process.env.CPE_USER || "").trim();
const portalPassword = String(process.env.CPE_PORTAL_PASSWORD || process.env.CPE_PASSWORD || "");
const headless = String(process.env.CPE_PORTAL_HEADLESS || process.env.CPE_HEADLESS || "true").toLowerCase() !== "false";
const applyChanges = process.argv.includes("--apply");
const inputArgIndex = process.argv.indexOf("--input");
const inputPath = inputArgIndex >= 0 && process.argv[inputArgIndex + 1]
  ? path.resolve(process.argv[inputArgIndex + 1])
  : null;

const TARGETS = [
  { id: "conductor-1a", name: "CONDUCTOR 1a", sourceConstant: "CENSO_RAW" },
  { id: "conductor-2a", name: "CONDUCTOR 2a", sourceConstant: "CONDUCTOR_2A_RAW" }
];

function cleanText(value = "") {
  return String(value).replace(/\u00a0/g, " ").replace(/\r/g, "").trim();
}

function normalizeForMatch(value = "") {
  return cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function exactTextPattern(text) {
  const escaped = String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*${escaped}\\s*$`, "i");
}

async function findVisibleAcrossFrames(page, getLocator, timeout = 12000) {
  const deadline = Date.now() + timeout;
  do {
    for (const frame of page.frames()) {
      const locator = getLocator(frame).first();
      if (await locator.isVisible().catch(() => false)) return { frame, locator };
    }
    await page.waitForTimeout(200);
  } while (Date.now() < deadline);
  return null;
}

async function readAuthState(page) {
  let loginVisible = false;
  let authenticated = false;
  const text = [];

  for (const frame of page.frames()) {
    const body = await frame.locator("body").innerText().catch(() => "");
    if (body) text.push(body);
    if (await frame.getByRole("button", { name: /Iniciar sesi/i }).first().isVisible().catch(() => false)) loginVisible = true;
    if (await frame.getByRole("button", { name: /Finalizar sesi/i }).first().isVisible().catch(() => false)) authenticated = true;
  }

  const body = normalizeForMatch(text.join("\n"));
  if (/Verificacion de seguridad|no eres un bot|Ray ID|challenges\.cloudflare/i.test(body)) return "blocked";
  if (/(?:usuario|contrasena|credenciales?).{0,45}(?:incorrect|invalid|errone)|acceso denegado/i.test(body)) return "rejected";
  if (authenticated || (/Consultas/i.test(body) && !loginVisible)) return "authenticated";
  return loginVisible ? "login" : "pending";
}

async function waitForAuthState(page, expected, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let state = "pending";
  do {
    state = await readAuthState(page);
    if (expected.includes(state)) return state;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return state;
}

async function login(page) {
  if (!portalUser || !portalPassword) throw new Error("Faltan CPE_PORTAL_USER y CPE_PORTAL_PASSWORD.");
  await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.getByRole("button", { name: "Entendido" }).click({ timeout: 1500 }).catch(() => {});

  let state = await waitForAuthState(page, ["authenticated", "login", "blocked", "rejected"], 20000);
  if (state === "authenticated") return;
  if (state === "blocked") throw new Error("El portal ha bloqueado temporalmente la lectura automatica.");

  const form = await findVisibleAcrossFrames(
    page,
    (frame) => frame.locator('input[title="Usuario"]:visible, input[type="text"]:visible'),
    12000
  );
  if (!form) throw new Error("No se encontro el formulario de acceso del portal.");

  const passwordInput = form.frame.locator('input[title*="Contrase"]:visible, input[type="password"]:visible').first();
  const loginButton = form.frame.getByRole("button", { name: /Iniciar sesi/i }).first();
  await form.locator.fill(portalUser);
  await passwordInput.fill(portalPassword);
  await loginButton.click();

  state = await waitForAuthState(page, ["authenticated", "blocked", "rejected"], 30000);
  if (state === "authenticated") return;
  if (state === "rejected") throw new Error("Usuario o contrasena del portal incorrectos.");
  if (state === "blocked") throw new Error("El portal ha bloqueado temporalmente la lectura automatica.");
  throw new Error("El portal no confirmo el inicio de sesion.");
}

async function findMenuItem(page, text, timeout = 12000) {
  const deadline = Date.now() + timeout;
  const pattern = exactTextPattern(text);
  do {
    for (const frame of page.frames()) {
      const matches = frame.locator(".NorayMenu .gwt-TreeItem, .gwt-TreeItem").filter({ hasText: pattern });
      for (let index = 0; index < await matches.count().catch(() => 0); index += 1) {
        const item = matches.nth(index);
        if (await item.isVisible().catch(() => false)) return item;
      }
    }
    await page.waitForTimeout(200);
  } while (Date.now() < deadline);
  return null;
}

async function openChaperoEspecialidades(page) {
  let item = await findMenuItem(page, "Chapero por especialidades", 2000);
  if (!item) {
    const consultas = await findMenuItem(page, "Consultas", 12000);
    if (!consultas) throw new Error("No se encontro el menu Consultas.");
    await consultas.click();
    item = await findMenuItem(page, "Chapero por especialidades", 12000);
  }
  if (!item) throw new Error("No se encontro Chapero por especialidades.");
  await item.click();

  const selectionDeadline = Date.now() + 15000;
  do {
    let submitted = false;
    for (const frame of page.frames()) {
      const submit = frame.locator('form[action*="InformeEspecialidadesChapSinE"] input[type="submit"]').first();
      if (await submit.isVisible().catch(() => false)) {
        await submit.click();
        submitted = true;
        break;
      }
    }
    if (submitted) break;
    await page.waitForTimeout(200);
  } while (Date.now() < selectionDeadline);

  const deadline = Date.now() + 30000;
  do {
    for (const frame of page.frames()) {
      const text = await frame.locator("body").innerText().catch(() => "");
      if (/CHAPERO POR ESPECIALIDADES/i.test(text) && /CONDUCTOR\s+1a/i.test(text)) return { frame, text };
    }
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  throw new Error("No se cargo el Chapero por especialidades.");
}

function parseSpecialty(pageText, target) {
  const normalized = cleanText(pageText);
  const escapedName = target.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalized.match(new RegExp(`${escapedName}\\s*\\(censo:\\s*(\\d+)\\)([\\s\\S]*?)(?=Disponibles:\\s*\\d+)`, "i"));
  if (!match) throw new Error(`No se encontro el bloque ${target.name}.`);

  const sourceChapas = match[2].match(/(?<!\d)\d{4}(?!\d)/g) || [];
  const duplicateChapas = sourceChapas.filter((value, index) => sourceChapas.indexOf(value) !== index);
  const expectedSize = Number(match[1]);
  if (sourceChapas.length !== expectedSize) {
    throw new Error(`${target.name}: se esperaban ${expectedSize} chapas y se leyeron ${sourceChapas.length}. No se aplican cambios.`);
  }
  if (duplicateChapas.length) {
    throw new Error(`${target.name}: hay chapas duplicadas (${[...new Set(duplicateChapas)].join(", ")}). No se aplican cambios.`);
  }

  return { ...target, expectedSize, sourceChapas };
}

function readCurrentCenso(source, constantName) {
  const match = source.match(new RegExp("const\\s+" + constantName + "\\s*=\\s*`([\\s\\S]*?)`;"));
  if (!match) throw new Error(`No se encontro ${constantName} en src/censo.js.`);
  return match[1].trim().split(/\s+/).filter(Boolean);
}

function compareCensos(current, next) {
  const currentPositions = new Map(current.map((chapa, index) => [chapa, index + 1]));
  const nextPositions = new Map(next.map((chapa, index) => [chapa, index + 1]));
  return {
    previousSize: current.length,
    nextSize: next.length,
    added: next.filter((chapa) => !currentPositions.has(chapa)),
    removed: current.filter((chapa) => !nextPositions.has(chapa)),
    moved: next
      .filter((chapa) => currentPositions.has(chapa) && currentPositions.get(chapa) !== nextPositions.get(chapa))
      .map((chapa) => ({ chapa: `7${chapa}`, from: currentPositions.get(chapa), to: nextPositions.get(chapa) }))
  };
}

function formatRawCenso(chapas, columns = 35) {
  const lines = [];
  for (let index = 0; index < chapas.length; index += columns) lines.push(chapas.slice(index, index + columns).join(" "));
  return `\n${lines.join("\n")}\n`;
}

function replaceCenso(source, target, parsed) {
  const rawPattern = new RegExp("(const\\s+" + target.sourceConstant + "\\s*=\\s*`)[\\s\\S]*?(`;)");
  let updated = source.replace(rawPattern, `$1${formatRawCenso(parsed.sourceChapas)}$2`);
  const specialtyPattern = new RegExp(`(id:\\s*"${target.id}"[\\s\\S]*?expectedSize:\\s*)\\d+`);
  updated = updated.replace(specialtyPattern, `$1${parsed.expectedSize}`);
  return updated;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  let pageText;

  if (inputPath) {
    pageText = await fs.readFile(inputPath, "utf8");
  } else {
    pageText = await readPortalCensos();
  }

  await fs.writeFile(path.join(outputDir, "chapero-especialidades.txt"), pageText, "utf8");

  const parsed = TARGETS.map((target) => parseSpecialty(pageText, target));
  let source = await fs.readFile(censoSourcePath, "utf8");
  const report = parsed.map((item) => ({
    specialty: item.name,
    firstChapa: `7${item.sourceChapas[0]}`,
    lastChapa: `7${item.sourceChapas.at(-1)}`,
    ...compareCensos(readCurrentCenso(source, item.sourceConstant), item.sourceChapas)
  }));

  await fs.writeFile(path.join(outputDir, "latest.json"), JSON.stringify({ parsedAt: new Date().toISOString(), source: inputPath || portalUrl, specialties: parsed, report }, null, 2), "utf8");
  for (const item of report) {
    console.log(`${item.specialty}: ${item.previousSize} -> ${item.nextSize}; primera ${item.firstChapa}; ultima ${item.lastChapa}; altas ${item.added.length}; bajas ${item.removed.length}; cambios de posicion ${item.moved.length}.`);
  }

  if (!applyChanges) {
    console.log("Comparacion terminada. Repite el comando con --apply para aplicar el censo validado.");
    return;
  }

  for (const item of parsed) source = replaceCenso(source, item, item);
  await fs.writeFile(censoSourcePath, source, "utf8");
  console.log("Censos validados y actualizados en src/censo.js.");
}

async function readPortalCensos() {
  await fs.mkdir(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1500, height: 1100 },
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    args: ["--disable-blink-features=AutomationControlled"]
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    await login(page);
    const chapero = await openChaperoEspecialidades(page);
    return chapero.text;
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
