import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export async function getLatestDoorSnapshot() {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("app_cpe_door_snapshots")
    .select("specialty, source, doors, raw_columns, updated_at")
    .eq("specialty", "CONDUCTOR 1a")
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
