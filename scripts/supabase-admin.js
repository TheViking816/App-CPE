export function resolveSupabaseAdminKey(env = process.env) {
  return String(env.CPE_SUPABASE_SECRET_KEY || env.CPE_SUPABASE_SERVICE_ROLE || "").trim();
}

export function supabaseAdminHeaders(key, extra = {}) {
  const normalized = String(key || "").trim();
  const headers = { apikey: normalized };

  // Supabase's modern sb_secret_ keys are API keys, not JWTs. Sending one as
  // a Bearer token makes PostgREST reject it as an invalid JWT. Legacy
  // service_role JWTs still require the Authorization header.
  if (normalized && !normalized.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${normalized}`;
  }

  return { ...headers, ...extra };
}
