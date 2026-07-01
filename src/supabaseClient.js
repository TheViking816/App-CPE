import { createClient } from "@supabase/supabase-js";

const defaultProjectRef = "wvwdiywtlbffumshbboa";

function resolveSupabaseUrl(value) {
  const firstLine = String(value || "").trim().split(/\s+/)[0] || defaultProjectRef;

  if (/^https?:\/\//i.test(firstLine)) {
    return firstLine.replace(/\/$/, "");
  }

  if (/^[a-z0-9]{20}$/i.test(firstLine)) {
    return `https://${firstLine}.supabase.co`;
  }

  return `https://${defaultProjectRef}.supabase.co`;
}

const supabaseUrl = resolveSupabaseUrl(import.meta.env.VITE_SUPABASE_URL);
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export async function registerUser({ chapa, password, specialties }) {
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("app_cpe_register", {
    p_chapa: chapa,
    p_password: password,
    p_specialties: specialties
  });

  if (error) throw error;
  return data;
}

export async function loginUser({ chapa, password }) {
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("app_cpe_login", {
    p_chapa: chapa,
    p_password: password
  });

  if (error) throw error;
  return data;
}

export async function updateUserSpecialties({ token, specialties }) {
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("app_cpe_update_specialties", {
    p_token: token,
    p_specialties: specialties
  });

  if (error) throw error;
  return data;
}

export async function trackUsageEvent({ eventType, chapa, metadata = {} }) {
  if (!supabase || !eventType) return null;

  const { data, error } = await supabase.rpc("app_cpe_track_event", {
    p_event_type: eventType,
    p_chapa: chapa || null,
    p_metadata: metadata
  });

  if (error) {
    console.warn("No se pudo registrar analitica:", error.message);
    return null;
  }

  return data;
}

export async function getLatestDoorSnapshot(specialty = "CONDUCTOR 1a") {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("app_cpe_door_snapshots")
    .select("specialty, source, doors, raw_columns, updated_at")
    .eq("specialty", specialty)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("No se pudieron leer puertas desde Supabase:", error.message);
    return null;
  }

  if (!data || !Array.isArray(data.doors)) return null;

  return {
    source: data.source || "supabase",
    specialty: data.specialty,
    updatedAt: data.updated_at,
    doors: data.doors,
    rawColumns: data.raw_columns || {}
  };
}

export async function requestDoorRefresh({ force = false } = {}) {
  if (!supabase) return null;

  const { data, error } = await supabase.functions.invoke("refresh-puertas", {
    body: { force }
  });

  if (error) {
    console.warn("No se pudo solicitar refresco de puertas:", error.message);
    return null;
  }

  return data || null;
}
