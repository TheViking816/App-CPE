const MADRID_TIME_ZONE = "Europe/Madrid";
const TARGET_WINDOWS = [
  { label: "07:20", minuteOfDay: 7 * 60 + 20 },
  { label: "12:20", minuteOfDay: 12 * 60 + 20 },
  { label: "14:45", minuteOfDay: 14 * 60 + 45 },
  { label: "15:00", minuteOfDay: 15 * 60 }
];
const WINDOW_MINUTES = 20;

function getMadridTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");
  return { hour, minute, minuteOfDay: hour * 60 + minute };
}

function getMatchedWindow(date = new Date()) {
  const time = getMadridTimeParts(date);
  const match = TARGET_WINDOWS.find((target) => Math.abs(time.minuteOfDay - target.minuteOfDay) <= WINDOW_MINUTES);
  return match ? { ...time, label: match.label } : null;
}

function resolveSupabaseUrl(value) {
  const projectRef = String(value || "wvwdiywtlbffumshbboa").trim();
  if (/^https?:\/\//i.test(projectRef)) return projectRef.replace(/\/$/, "");
  return `https://${projectRef}.supabase.co`;
}

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") {
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.authorization !== `Bearer ${cronSecret}`) {
    return response.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const force = request.query?.force === "1" || request.query?.force === "true";
  const matchedWindow = getMatchedWindow();

  if (!force && !matchedWindow) {
    return response.status(200).json({
      ok: true,
      triggered: false,
      skipped: true,
      reason: "outside_refresh_window",
      madridTime: getMadridTimeParts()
    });
  }

  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseKey) {
    return response.status(500).json({ ok: false, error: "Missing Supabase publishable key" });
  }

  const supabaseUrl = resolveSupabaseUrl(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
  const refreshResponse = await fetch(`${supabaseUrl}/functions/v1/refresh-puertas`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${supabaseKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ force, ref: "main", source: "supabase-cron" })
  });

  const bodyText = await refreshResponse.text();
  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { raw: bodyText };
  }

  return response.status(refreshResponse.ok ? 202 : 502).json({
    ok: refreshResponse.ok,
    triggered: refreshResponse.ok,
    matchedWindow,
    refreshStatus: refreshResponse.status,
    refresh: body
  });
}
