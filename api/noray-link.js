const PILOT_CHAPA = "72683";
const NORAY_ORIGIN = "https://norayweb.cpevalencia.com";
const SECTIONS = new Set([
  "jornales",
  "donde-voy",
  "mis-especialidades",
  "chapero",
  "chapero-especialidades",
  "jornada-contratada"
]);

function requestBody(request) {
  if (request.body instanceof URLSearchParams) return Object.fromEntries(request.body);
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  const raw = Buffer.isBuffer(request.body) ? request.body.toString("utf8") : String(request.body || "");
  if (request.headers["content-type"]?.includes("application/json")) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function sendError(response, status, message) {
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(message);
}

export default async function handler(request, response) {
  response.setHeader("cache-control", "private, no-store, max-age=0");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-robots-tag", "noindex, nofollow");

  if (request.method !== "POST") {
    return sendError(response, 405, "Método no permitido.");
  }

  if (Number(request.headers["content-length"] || 0) > 4096) {
    return sendError(response, 413, "Solicitud demasiado grande.");
  }

  const body = requestBody(request);
  const token = String(body.token || "");
  const section = String(body.section || "");
  if (!token || token.length > 256 || !SECTIONS.has(section)) {
    return sendError(response, 400, "Acceso no disponible.");
  }

  const rawSupabaseUrl = String(process.env.VITE_SUPABASE_URL || "").replace(/\\r|\\n/g, "").trim().split(/\s+/)[0];
  const supabaseUrl = /^[a-z0-9]{20}$/i.test(rawSupabaseUrl)
    ? `https://${rawSupabaseUrl}.supabase.co`
    : rawSupabaseUrl.replace(/\/$/, "");
  const supabaseKey = String(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!supabaseUrl || !supabaseKey) {
    return sendError(response, 503, "Acceso temporalmente no disponible.");
  }

  try {
    const result = await fetch(`${supabaseUrl}/rest/v1/rpc/app_cpe_get_noray_link`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ p_token: token, p_section: section }),
      cache: "no-store"
    });
    if (!result.ok) return sendError(response, 403, "Acceso no disponible.");

    const target = new URL(await result.json());
    if (
      target.origin !== NORAY_ORIGIN ||
      target.pathname !== `/${section}` ||
      target.searchParams.get("usr") !== PILOT_CHAPA ||
      target.searchParams.get("rec") !== "2611" ||
      !/^[a-f0-9]{64}$/.test(target.searchParams.get("pwd") || "")
    ) {
      return sendError(response, 502, "El enlace del portal no es válido.");
    }

    response.statusCode = 303;
    response.setHeader("location", target.href);
    return response.end();
  } catch {
    return sendError(response, 503, "No se pudo abrir la sección. Inténtalo de nuevo.");
  }
}
