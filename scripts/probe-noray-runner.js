import { pathToFileURL } from "node:url";

const ORIGIN = "https://norayweb.cpevalencia.com";

export function pilotUrl(raw) {
  const url = new URL(String(raw || ""));
  if (url.origin !== ORIGIN || url.pathname !== "/jornales") throw new Error("Enlace piloto no válido");
  if (url.searchParams.get("usr") !== "72683" || url.searchParams.get("rec") !== "2611") {
    throw new Error("Identidad piloto no válida");
  }
  if (!/^[a-f0-9]{64}$/.test(url.searchParams.get("pwd") || "")) {
    throw new Error("Credencial piloto no válida");
  }
  return url;
}

export function isChallenge(headers, body = "") {
  return headers.get("cf-mitigated") === "challenge" || /Just a moment|Verificaci[oó]n de seguridad|cf-chl/i.test(body);
}

export async function probeNoray({ rawUrl, browserType, httpFetch = fetch, write = console.log } = {}) {
  const url = pilotUrl(rawUrl);
  let httpStatus = "error de red";
  let httpChallenge = false;
  try {
    const response = await httpFetch(url.href, { signal: AbortSignal.timeout(20000), redirect: "manual" });
    httpStatus = response.status;
    httpChallenge = isChallenge(response.headers, await response.text());
  } catch {
    // Network errors may contain the credential-bearing URL; do not log them.
  }
  write(`HTTP directo: ${httpStatus}; desafío Cloudflare: ${httpChallenge ? "sí" : "no"}`);

  const launcher = browserType || (await import("playwright")).chromium;
  const headed = process.env.CPE_NORAY_PILOT_HEADED === "1";
  const browser = await launcher.launch({ headless: !headed, ...(headed ? { channel: "chrome" } : {}) });
  try {
    const page = await browser.newPage();
    let navigation;
    try {
      navigation = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch {
      throw new Error("El navegador del runner no pudo abrir Noray");
    }
    const body = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    const browserChallenge = isChallenge(new Headers(navigation?.headers() || {}), body);
    write(`Navegador del runner: HTTP ${navigation?.status() || "sin respuesta"}; desafío Cloudflare: ${browserChallenge ? "sí" : "no"}`);
    if (browserChallenge) throw new Error("Cloudflare desafió al navegador del runner");

    const auth = await page.evaluate(async () => {
      const params = new URLSearchParams(location.search);
      const response = await fetch("/api/v1/auth/validar-acceso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usr: params.get("usr"),
          rec: Number(params.get("rec")),
          pwd: params.get("pwd")
        })
      });
      if (!response.ok) return { authStatus: response.status, challenge: response.headers.get("cf-mitigated") === "challenge" };
      const data = await response.json();
      if (!data.intranet_access_token || data.intranet_available === false) return { authStatus: response.status, authorized: false };
      const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit" }).formatToParts(new Date());
      const year = Number(parts.find((part) => part.type === "year")?.value);
      const month = Number(parts.find((part) => part.type === "month")?.value);
      const journal = await fetch(`/api/v1/jornales/${params.get("rec")}/${year}/${month}?incluir_en_curso=false`, {
        headers: { Authorization: `Bearer ${data.intranet_access_token}` }
      });
      if (!journal.ok) return { authStatus: response.status, authorized: true, journalStatus: journal.status, challenge: journal.headers.get("cf-mitigated") === "challenge" };
      const result = await journal.json();
      return { authStatus: response.status, authorized: true, journalStatus: journal.status, count: Array.isArray(result?.jornales) ? result.jornales.length : -1 };
    }).catch(() => ({ authStatus: "error de red" }));

    write(`Autenticación Noray: ${auth.authStatus}; Jornales: ${auth.journalStatus ?? "no consultado"}; registros: ${auth.count ?? "no disponibles"}`);
    if (auth.challenge) throw new Error("Cloudflare desafió la API de Noray");
    if (!auth.authorized || auth.journalStatus !== 200 || auth.count < 0) {
      throw new Error("El runner no pudo verificar los datos de Jornales");
    }
    return { httpStatus, httpChallenge, browserChallenge, journals: auth.count };
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  probeNoray({ rawUrl: process.env.CPE_NORAY_PILOT_72683_URL }).catch((error) => {
    console.error(`Prueba Noray: ${error instanceof Error ? error.message : "error inesperado"}`);
    process.exitCode = 1;
  });
}
