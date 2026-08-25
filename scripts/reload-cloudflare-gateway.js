import { chromium } from "playwright";

const endpoint = String(process.argv[2] || process.env.CPE_PORTAL_CDP_ENDPOINT || "http://127.0.0.1:9223").trim();
const portalUrl = "https://portal.cpevalencia.com/#User";
const challengePattern = /Verificaci[oó]n de seguridad|verifique que es un ser humano|Just a moment|Ray ID/i;
const portalPattern = /Iniciar sesi[oó]n|loginFields|title=["']Usuario["']|Finalizar sesi[oó]n/i;

const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
const context = browser.contexts()[0];
if (!context) throw new Error("Chrome no expone el contexto principal del gateway.");

let page = context.pages().find((candidate) => candidate.url().startsWith("https://portal.cpevalencia.com/"));
if (!page) page = await context.newPage();

try {
  if (!page.url().startsWith("https://portal.cpevalencia.com/")) {
    await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  }

  let state = "empty";
  let status = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    status = response?.status() || 0;
    await page.waitForTimeout(5000);
    const contents = await Promise.all(page.frames().map((frame) => frame.content().catch(() => "")));
    const content = contents.join("\n");
    if (portalPattern.test(content)) {
      state = "portal";
      break;
    }
    if (challengePattern.test(content)) {
      state = "challenge";
      break;
    }
  }

  console.log(JSON.stringify({ ok: state !== "empty", state, status, location: page.url().split("?")[0] }));
  if (state === "empty") process.exitCode = 2;
} finally {
  browser._connection.close();
}

process.exit(process.exitCode || 0);
