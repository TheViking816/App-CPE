import { chromium } from "playwright";

const portalUrl = "https://portal.cpevalencia.com/#User";
const cdpEndpoint = String(process.env.CPE_PORTAL_CDP_ENDPOINT || "http://127.0.0.1:9223").trim();
const contextCount = Math.max(1, Math.min(10, Number(process.env.CPE_CLOUDFLARE_POOL_SIZE || 10)));
const challengePattern = /Verificaci[oó]n de seguridad|verifique que es un ser humano|challenge-platform|cf-chl-|Just a moment/i;
const loginPattern = /Iniciar sesi[oó]n|loginFields|title=["']Usuario["']/i;

const browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 15000 });
const gatewayContext = browser.contexts()[0];
if (!gatewayContext) throw new Error("Chrome no expone el contexto principal del gateway.");

const gatewayCookies = await gatewayContext.cookies("https://portal.cpevalencia.com");
const clearanceCookies = gatewayCookies
  .filter((cookie) => cookie.name === "cf_clearance" || cookie.name.startsWith("cf_chl_"))
  .map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite
  }));

if (!clearanceCookies.some((cookie) => cookie.name === "cf_clearance")) {
  console.log(JSON.stringify({ ok: false, reason: "missing_clearance", contexts: 0 }));
  process.exitCode = 2;
} else {
  const contexts = [];
  try {
    const results = await Promise.all(Array.from({ length: contextCount }, async (_, index) => {
      const context = await browser.newContext({
        locale: "es-ES",
        timezoneId: "Europe/Madrid",
        viewport: { width: 1365, height: 900 }
      });
      contexts.push(context);
      await context.addCookies(clearanceCookies);
      const page = await context.newPage();
      const response = await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
      const deadline = Date.now() + 20000;
      let content = "";
      let challenge = false;
      let portal = false;
      do {
        const frameContents = await Promise.all(page.frames().map((frame) => frame.content().catch(() => "")));
        content = frameContents.join("\n");
        challenge = challengePattern.test(content);
        portal = loginPattern.test(content) || /Finalizar sesi[oó]n/i.test(content);
        if (challenge || portal) break;
        await page.waitForTimeout(500);
      } while (Date.now() < deadline);
      return {
        slot: index + 1,
        status: response?.status() || 0,
        challenge,
        portal,
        location: page.url().split("?")[0]
      };
    }));
    const ok = results.every((result) => result.portal && !result.challenge);
    console.log(JSON.stringify({
      ok,
      contexts: contextCount,
      passed: results.filter((result) => result.portal && !result.challenge).length,
      challenged: results.filter((result) => result.challenge).length,
      results
    }));
    if (!ok) process.exitCode = 3;
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  }
}

process.exit(process.exitCode || 0);
