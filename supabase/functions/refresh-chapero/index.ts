import { createClient } from "https://esm.sh/@supabase/supabase-js@2.109.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  ?? Deno.env.get("CPE_SUPABASE_SERVICE_ROLE")
  ?? "";
const chaperoUrl = Deno.env.get("CPE_CHAPERO_URL")
  ?? "https://portal.cpevalencia.com/Noray/Chapero.asp?mode=GWT&devType=Desktop&device=Desktop&browser=Chrome&os=Windows&rd=744375419261120260702080606";

const statusLabels: Record<string, string> = {
  contratado: "Contratado",
  anticipado: "Anticipado",
  nocontratado: "No contratado",
  falta: "No disponible",
  excepcion: "Con excepcion",
  doble: "Doble"
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function normalizeChaperoChapa(raw: string) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 5) return digits.slice(-5);
  return `7${digits.padStart(4, "0")}`;
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function textFromHtml(html: string) {
  return decodeHtml(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n");
}

function parseHeader(html: string) {
  const text = textFromHtml(html);
  const pageDate = text.match(/(\d{2}\/\d{2}\/\d{4}\s+-\s+\d{2}:\d{2})/)?.[1] ?? "";
  const jornadaMatch = text.match(/ULTIMA\s+JORNADA\s+CONTRATADA:\s*(\d{2}\/\d{2}\/\d{2})\s+-\s+DE\s+(\d{2})\s+A\s+(\d{2})\s+H/i);

  return {
    pageDate,
    jornadaText: jornadaMatch
      ? `ULTIMA JORNADA CONTRATADA: ${jornadaMatch[1]} - DE ${jornadaMatch[2]} A ${jornadaMatch[3]} H.`
      : "",
    jornadaDate: jornadaMatch?.[1] ?? null,
    fromHour: jornadaMatch?.[2] ?? null,
    toHour: jornadaMatch?.[3] ?? null,
    shiftKey: jornadaMatch && ["20", "02"].includes(jornadaMatch[2]) ? "NOC" : "LAB"
  };
}

function parseChapero(html: string) {
  const workers = [...html.matchAll(/<span\s+class=["']([^"']+)["'][^>]*>\s*(\d{4,5})\s*<\/span>/gi)]
    .map((match) => ({
      status: match[1].trim(),
      rawChapa: match[2].trim()
    }))
    .filter((item) => statusLabels[item.status])
    .map((item) => ({
      rawChapa: item.rawChapa,
      chapa: normalizeChaperoChapa(item.rawChapa),
      status: item.status,
      label: statusLabels[item.status]
    }));

  const summary = workers.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  return {
    source: chaperoUrl,
    updatedAt: new Date().toISOString(),
    ...parseHeader(html),
    summary,
    workers
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  if (!projectUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "Supabase service role is not configured" }, 200);
  }

  try {
    const response = await fetch(chaperoUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) {
      return jsonResponse({ ok: false, status: response.status, error: await response.text() }, 200);
    }

    const snapshot = parseChapero(await response.text());
    if (!snapshot.workers.length) {
      return jsonResponse({ ok: false, error: "No se encontraron chapas en Chapero" }, 200);
    }

    const supabase = createClient(projectUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    const { error } = await supabase
      .from("app_cpe_chapero_snapshots")
      .upsert({
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
      }, { onConflict: "snapshot_key" });

    if (error) return jsonResponse({ ok: false, error: error.message }, 200);

    return jsonResponse({
      ok: true,
      updatedAt: snapshot.updatedAt,
      pageDate: snapshot.pageDate,
      summary: snapshot.summary
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, 200);
  }
});
