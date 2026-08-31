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
  const readPortalState = async () => {
    const contents = await Promise.all(page.frames().map((frame) => frame.content().catch(() => "")));
    const content = contents.join("\n");
    if (portalPattern.test(content)) {
      state = "portal";
      return state;
    }
    if (challengePattern.test(content)) {
      state = "challenge";
      return state;
    }
    return "empty";
  };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // A browser reload can resubmit the POST used by the portal login. The
    // portal rejects that replay with HTTP 405, so force a fresh GET while
    // preserving the gateway context, cookies and authenticated session.
    await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 15000 });
    const response = await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    status = response?.status() || 0;
    await page.waitForTimeout(5000);
    state = await readPortalState();
    if (state !== "empty") break;

    // En este estado el portal ha contestado 200 pero ha dejado el documento
    // vacío. Una recarga normal de la pestaña es exactamente lo que lo
    // desbloquea manualmente, así que la hacemos y volvemos a verificar.
    const reloadResponse = await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => null);
    status = reloadResponse?.status() || status;
    await page.waitForTimeout(5000);
    state = await readPortalState();
    if (state !== "empty") break;
  }

  console.log(JSON.stringify({ ok: state !== "empty", state, status, location: page.url().split("?")[0] }));
  if (state === "empty") process.exitCode = 2;
} finally {
  browser._connection.close();
}

process.exit(process.exitCode || 0);
