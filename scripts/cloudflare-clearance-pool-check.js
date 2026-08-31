import { chromium } from "playwright";

const portalUrl = "https://portal.cpevalencia.com/#User";
const cdpEndpoint = String(process.env.CPE_PORTAL_CDP_ENDPOINT || "http://127.0.0.1:9223").trim();
const contextCount = 1;
// Cloudflare leaves normal challenge bootstrap scripts in the HTML even after
// clearance. Only visible challenge copy (or a Ray ID error page) means the
// gateway is blocked.
const challengePattern = /Verificaci[oó]n de seguridad|verifique que es un ser humano|Just a moment|Ray ID/i;
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
  let createdPage = null;
  try {
    const results = await Promise.all(Array.from({ length: contextCount }, async (_, index) => {
      // Validate the exact visible Chrome context that solved the challenge.
      // Creating an incognito context and copying cf_clearance can produce a
      // false 403 because Cloudflare also binds the clearance to the browser.
      let page = gatewayContext.pages().find((candidate) => candidate.url().startsWith("https://portal.cpevalencia.com"));
      if (!page) {
        page = await gatewayContext.newPage();
        createdPage = page;
      }
      const response = await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
      const deadline = Date.now() + 20000;
      let content = "";
      let challenge = false;
      let portal = false;
      do {
        const frameContents = await Promise.all(page.frames().map((frame) => frame.content().catch(() => "")));
        content = frameContents.join("\n");
        portal = loginPattern.test(content) || /Finalizar sesi[oó]n/i.test(content);
        challenge = !portal && challengePattern.test(content);
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
    if (createdPage) await createdPage.close().catch(() => {});
  }
}

process.exit(process.exitCode || 0);
