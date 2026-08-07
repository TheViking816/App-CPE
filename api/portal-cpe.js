const PORTAL_BASE_URL = "https://portal.cpevalencia.com/";
const DEFAULT_TIMEOUT_MS = 20000;

function send(response, body, status = 200) {
  response.status(status);
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  return response.json(body);
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function textFromHtml(html = "") {
  return decodeHtml(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " | ")
    .replace(/<\/th>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\|\s+/g, "|")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function normalizeChapa(value = "") {
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";
  return digits.length >= 5 ? digits.slice(-5) : `7${digits.padStart(4, "0")}`;
}

function isCloudflareChallenge(html = "") {
  return /cf_chl|challenge-platform|Enable JavaScript and cookies|Just a moment/i.test(html);
}

function createError(code, message, detail = null) {
  return { ok: false, code, message, detail };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: "manual",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "es-ES,es;q=0.9",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseRowsFromTable(html = "") {
  const rows = [];
  const rowMatches = html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const rowMatch of rowMatches) {
    const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((match) => textFromHtml(match[1]).replace(/\|/g, " ").trim())
      .filter(Boolean);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function parseJornales(html = "") {
  const rows = parseRowsFromTable(html);
  const headerIndex = rows.findIndex((row) => row.some((cell) => /jornal/i.test(cell)) && row.some((cell) => /especialidad/i.test(cell)));
  if (headerIndex === -1) return { monthLabel: "", rows: [] };

  const headers = rows[headerIndex].map((item) => item.toLowerCase());
  const dataRows = rows.slice(headerIndex + 1)
    .filter((row) => row.length >= 6)
    .map((row) => ({
      jornal: row[headers.findIndex((item) => item.includes("jornal"))] || row[0] || "",
      parte: row[headers.findIndex((item) => item.includes("parte"))] || row[1] || "",
      dia: row[headers.findIndex((item) => item === "dia")] || row[2] || "",
      tipo: row[headers.findIndex((item) => item.includes("tipo"))] || row[3] || "",
      jornada: row[headers.findIndex((item) => item.includes("jornada"))] || row[4] || "",
      especialidad: row[headers.findIndex((item) => item.includes("especialidad"))] || row[5] || "",
      empresa: row[headers.findIndex((item) => item.includes("empresa"))] || row[6] || "",
      buque: row[headers.findIndex((item) => item.includes("buque"))] || row[7] || "",
      operacion: row[headers.findIndex((item) => item.includes("operaci"))] || row[8] || "",
      produccion: row[headers.findIndex((item) => item.includes("producci"))] || row[9] || ""
    }));

  const pageText = textFromHtml(html);
  const monthLabel = pageText.match(/Jornales\s+de\s+([^\n|]+)/i)?.[1]?.trim() || "";
  return { monthLabel, rows: dataRows };
}

function parseDescansos(html = "") {
  const pageText = textFromHtml(html);
  const worker = {
    chapa: normalizeChapa(pageText.match(/\b7\d{4}\b/)?.[0] || ""),
    name: pageText.match(/\b7\d{4}\b\s+([A-ZÁÉÍÓÚÑ ]{6,})/i)?.[1]?.trim() || "",
    group: pageText.match(/Grupo\s+de\s+Descanso\s+\d{4}:\s*([^\n|]+)/i)?.[1]?.trim() || "",
    currentMonthRest: Number(pageText.match(/Descansos\s+mes\s+actual:\s*\((\d+)\)/i)?.[1] || 0),
    nextMonthRest: Number(pageText.match(/Descansos\s+proximo\s+mes:\s*\((\d+)\)/i)?.[1] || 0)
  };

  const events = [];
  const codePattern = /\b(DS|SL|FS|VA)\b/gi;
  for (const match of pageText.matchAll(codePattern)) {
    events.push({ code: match[1].toUpperCase() });
  }

  return {
    worker,
    totals: events.reduce((acc, event) => {
      acc[event.code] = (acc[event.code] || 0) + 1;
      return acc;
    }, {}),
    events
  };
}

function parsePrimas(html = "") {
  const rows = parseRowsFromTable(html);
  return {
    rows: rows
      .filter((row) => row.length > 1)
      .map((row) => ({ values: row }))
  };
}

async function tryPortalProbe() {
  const response = await fetchWithTimeout(PORTAL_BASE_URL);
  const html = await response.text();

  if (isCloudflareChallenge(html)) {
    return createError(
      "portal_cloudflare",
      "El portal oficial ha bloqueado el acceso automatico desde servidor. La app no ha enviado ni guardado tus claves.",
      "Cloudflare challenge"
    );
  }

  return { ok: true, html, cookies: response.headers.get("set-cookie") || "" };
}

function readBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") return JSON.parse(request.body);
  return request.body;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return send(response, createError("method_not_allowed", "Metodo no permitido."), 405);
  }

  let body = {};
  try {
    body = readBody(request);
  } catch {
    return send(response, createError("bad_request", "Solicitud no valida."), 400);
  }

  const chapa = normalizeChapa(body.chapa || body.username);
  const password = String(body.password || "");
  const securityKey = String(body.securityKey || "");
  const section = String(body.section || "all");

  if (!chapa || !password) {
    return send(response, createError("missing_credentials", "Introduce usuario y contrasena del portal."), 400);
  }

  const probe = await tryPortalProbe();
  if (!probe.ok) return send(response, probe, 502);

  return send(response, {
    ok: false,
    code: "portal_mapping_pending",
    message: "El portal responde, pero falta mapear los endpoints internos de login y consulta.",
    parsedPreview: {
      jornales: section === "jornales" || section === "all" ? parseJornales(probe.html) : null,
      descansos: section === "descansos" || section === "all" ? parseDescansos(probe.html) : null,
      primas: securityKey && (section === "primas" || section === "all") ? parsePrimas(probe.html) : null
    }
  }, 501);
}
