import { createClient } from "@supabase/supabase-js";
import { registerWithNetworkRecovery } from "./authRecovery.js";

const defaultProjectRef = "wvwdiywtlbffumshbboa";

function resolveSupabaseUrl(value) {
  const firstLine = String(value || "")
    .replace(/\\r|\\n/g, "")
    .trim()
    .split(/\s+/)[0] || defaultProjectRef;

  if (/^https?:\/\//i.test(firstLine)) {
    try {
      return new URL(firstLine).origin;
    } catch {
      return `https://${defaultProjectRef}.supabase.co`;
    }
  }

  if (/^[a-z0-9]{20}$/i.test(firstLine)) {
    return `https://${firstLine}.supabase.co`;
  }

  return `https://${defaultProjectRef}.supabase.co`;
}

const viteEnv = import.meta.env || {};
const supabaseUrl = resolveSupabaseUrl(viteEnv.VITE_SUPABASE_URL);
const supabaseKey = String(viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY || "")
  .replace(/\\r|\\n/g, "")
  .trim();
// Vercel can preserve a trailing line break/space when an environment value is
// entered from the CLI.  These identifiers are used as exact RPC parameters,
// so normalize them before asking Supabase for the preview snapshot.
const syncWorkflowRef = String(viteEnv.VITE_GITHUB_SYNC_REF || "main").trim() || "main";
const portalSnapshotChannel = String(viteEnv.VITE_PORTAL_SNAPSHOT_CHANNEL || "").trim();

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

const USAGE_TRACKING_EXCLUDED_CHAPAS = new Set(["72683"]);

export async function registerUser({ chapa, password, email, specialties }) {
  if (!supabase) return null;

  const register = async () => {
    const { data, error } = await supabase.rpc("app_cpe_register", {
      p_chapa: chapa,
      p_password: password,
      p_email: email,
      p_specialties: specialties
    });

    if (error) throw error;
    return data;
  };

  return registerWithNetworkRecovery({
    register,
    login: () => loginUser({ chapa, password }),
    wait: () => new Promise((resolve) => window.setTimeout(resolve, 700))
  });
}

export async function sendPendingActivationEmails() {
  try {
    const response = await fetch("https://portalestiba-push-backend-one.vercel.app/api/push/notify-new-hire", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_cpe_activation_emails: true }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn("No se pudo enviar el aviso de activación:", error.message);
    return null;
  }
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

export async function updateUserPassword({ token, currentPassword, newPassword }) {
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("app_cpe_change_password", {
    p_token: token,
    p_current_password: currentPassword,
    p_new_password: newPassword
  });

  if (error) throw error;
  return data;
}

export async function deleteUserAccount({ token, currentPassword, confirmation }) {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.rpc("app_cpe_delete_account", {
    p_token: token,
    p_current_password: currentPassword,
    p_confirmation: confirmation
  });

  if (error) throw error;
  return data || null;
}

export async function updateUserIrpf({ token, irpfRate }) {
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("app_cpe_update_irpf", {
    p_token: token,
    p_irpf_rate: irpfRate
  });

  if (error) throw error;
  return data;
}

export async function getUserRelayHours({ token }) {
  if (!supabase || !token) return {};

  const { data, error } = await supabase.rpc("app_cpe_get_relay_hours", { p_token: token });
  if (error) throw error;
  return data || {};
}

export async function setUserRelayHour({ token, jornalKey, enabled }) {
  if (!supabase || !token || !jornalKey) return null;

  const { data, error } = await supabase.rpc("app_cpe_set_relay_hour", {
    p_token: token,
    p_jornal_key: jornalKey,
    p_enabled: enabled
  });
  if (error) throw error;
  return data;
}

export async function loadPayrollConfig() {
  if (!supabase) return null;

  const [holidaysResult, ratesResult, complementsResult] = await Promise.all([
    supabase.from("app_cpe_payroll_holidays").select("holiday_date, name, enabled").eq("enabled", true),
    supabase.from("app_cpe_payroll_rates").select("operation_type, worker_group, rate_key, shift_key, amount, enabled").eq("enabled", true),
    supabase.from("app_cpe_specialty_complements")
      .select("specialty_key, specialty_name, amount, servicio_publico_02_08, servicio_publico_08_14, servicio_publico_14_20, servicio_publico_20_02, recepcion_entrega_02_08, recepcion_entrega_08_14, recepcion_entrega_14_20, recepcion_entrega_20_02, festivo, enabled")
      .eq("enabled", true)
  ]);

  const error = holidaysResult.error || ratesResult.error || complementsResult.error;
  if (error) throw error;

  return {
    holidays: holidaysResult.data || [],
    rates: ratesResult.data || [],
    complements: complementsResult.data || []
  };
}

export async function trackUsageEvent({ eventType, chapa, metadata = {} }) {
  if (!supabase || !eventType) return null;
  const normalizedChapa = String(chapa || "").replace(/\D/g, "").slice(-5);

  if (USAGE_TRACKING_EXCLUDED_CHAPAS.has(normalizedChapa)) {
    return null;
  }

  const { data, error } = await supabase.rpc("app_cpe_track_event", {
    p_event_type: eventType,
    p_chapa: normalizedChapa || null,
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

export async function getLatestDoorSnapshots(specialtyNames = []) {
  if (!supabase || !Array.isArray(specialtyNames) || specialtyNames.length === 0) return [];

  const { data, error } = await supabase
    .from("app_cpe_door_snapshots")
    .select("specialty, source, doors, raw_columns, updated_at")
    .in("specialty", specialtyNames);

  if (error) {
    console.warn("No se pudieron leer puertas desde Supabase:", error.message);
    return [];
  }

  return (data || [])
    .filter((item) => Array.isArray(item.doors))
    .map((item) => ({
      source: item.source || "supabase",
      specialty: item.specialty,
      updatedAt: item.updated_at,
      doors: item.doors,
      rawColumns: item.raw_columns || {}
    }));
}

export async function getLatestChaperoSnapshot() {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("app_cpe_chapero_snapshots")
    .select("source, page_date, jornada_text, jornada_date, from_hour, to_hour, shift_key, summary, workers, updated_at")
    .eq("snapshot_key", "latest")
    .maybeSingle();

  if (error) {
    console.warn("No se pudo leer Chapero desde Supabase:", error.message);
    return null;
  }

  if (!data || !Array.isArray(data.workers)) return null;

  return {
    source: data.source || "supabase",
    pageDate: data.page_date,
    jornadaText: data.jornada_text,
    jornadaDate: data.jornada_date,
    fromHour: data.from_hour,
    toHour: data.to_hour,
    shiftKey: data.shift_key || "LAB",
    summary: data.summary || {},
    workers: data.workers,
    updatedAt: data.updated_at
  };
}

export async function requestDoorRefresh({ force = false } = {}) {
  if (!supabase) return null;

  const { data, error } = await supabase.functions.invoke("refresh-puertas", {
    body: { force, ref: syncWorkflowRef }
  });

  if (error) {
    console.warn("No se pudo solicitar refresco de puertas:", error.message);
    return null;
  }

  return data || null;
}

export async function requestChaperoRefresh() {
  if (!supabase) return null;

  const { data, error } = await supabase.functions.invoke("refresh-puertas", {
    body: { force: true, ref: syncWorkflowRef }
  });

  if (error) {
    console.warn("No se pudo solicitar refresco de Chapero:", error.message);
    return null;
  }

  return data || null;
}

export async function getOfficialPortalSnapshot({ token }) {
  if (!supabase || !token) return null;

  const { data, error } = portalSnapshotChannel
    ? await supabase.rpc("app_cpe_get_portal_preview_snapshot", {
        p_token: token,
        p_channel: portalSnapshotChannel
      })
    : await supabase.rpc("app_cpe_get_portal_snapshot", { p_token: token });

  if (error) {
    console.warn("No se pudo leer el portal oficial sincronizado:", error.message);
    throw error;
  }

  return data;
}

export async function getOfficialPortalDocument({ token, documentId }) {
  if (!supabase || !token || !documentId) return null;

  const { data, error } = await supabase.rpc("app_cpe_get_portal_document", {
    p_token: token,
    p_channel: portalSnapshotChannel || "main",
    p_document_id: documentId
  });

  if (error) throw error;
  return data || null;
}

export async function requestOfficialPortalDocument({ token, documentId }) {
  if (!supabase || !token || !documentId) return null;

  const { data, error } = await supabase.functions.invoke("refresh-portal", {
    body: {
      token,
      requestKind: "document",
      documentId,
      ref: syncWorkflowRef
    }
  });

  if (error) throw error;
  if (data?.ok === false) throw new Error(data.error || "No se pudo solicitar la nomina.");
  return data || null;
}

export async function trackPageVisit({ token, page }) {
  if (!supabase || !token || !page) return null;

  const { data, error } = await supabase.rpc("app_cpe_track_page_visit", {
    p_token: token,
    p_page: page
  });

  if (error) {
    console.warn("No se pudo registrar la visita de página:", error.message);
    return null;
  }

  return data;
}

export async function getUsageMonitor({ token }) {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.rpc("app_cpe_get_usage_monitor", {
    p_token: token
  });

  if (error) throw error;
  return data;
}

export async function getAdminPortalSyncUsers({ token }) {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.rpc("app_cpe_admin_portal_sync_users", {
    p_token: token
  });

  if (error) throw error;
  return data;
}

export async function queueAdminPortalSyncUsers({ token, chapas, fullHistory = false }) {
  if (!supabase || !token || !chapas?.length) return null;

  const { data, error } = await supabase.rpc("app_cpe_admin_queue_portal_sync_users", {
    p_token: token,
    p_chapas: chapas,
    p_full_history: fullHistory
  });

  if (error) throw error;
  return data;
}

export async function refreshCurrentUser({ token }) {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.rpc("app_cpe_get_current_user", {
    p_token: token
  });

  if (error) throw error;
  return data || null;
}

export async function updateActivationEmail({ token, email }) {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.rpc("app_cpe_update_activation_email", {
    p_token: token,
    p_email: email
  });

  if (error) throw error;
  return data || null;
}

export async function requestPortalSync({ token, portalPassword, securityKey = "", fullHistory = false, requestKind = "" }) {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.functions.invoke("refresh-portal", {
    body: {
      token,
      portalPassword,
      securityKey,
      requestKind: requestKind || (fullHistory ? "history" : "snapshot"),
      ref: syncWorkflowRef
    }
  });

  if (error) {
    throw error;
  }

  if (data?.ok === false) {
    throw new Error(data.error || "No se pudo lanzar la lectura del portal.");
  }

  return data || null;
}

export async function queuePendingPortalActivation({ token }) {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.rpc("app_cpe_queue_pending_portal_activation", {
    p_token: token
  });

  if (error) throw error;
  return data || null;
}

export async function getPortalAutoSyncStatus({ token }) {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.rpc("app_cpe_get_portal_auto_sync_status", {
    p_token: token
  });

  if (error) throw error;
  return data || null;
}

export async function touchPortalActivity({ token }) {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.rpc("app_cpe_touch_portal_activity", {
    p_token: token
  });

  if (error) throw error;
  return data || null;
}

export async function reactivatePortalSync({ token }) {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.rpc("app_cpe_reactivate_portal_sync", {
    p_token: token
  });

  if (error) throw error;
  return data || null;
}

export async function setPortalAutoSync({ token, enabled, portalPassword = "", securityKey = "" }) {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.rpc("app_cpe_set_portal_auto_sync", {
    p_token: token,
    p_enabled: enabled,
    p_portal_password: portalPassword,
    p_security_key: securityKey
  });

  if (error) throw error;
  return data || null;
}

export async function setPortalSecurityKey({ token, securityKey }) {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.rpc("app_cpe_set_portal_security_key", {
    p_token: token,
    p_security_key: securityKey
  });

  if (error) throw error;
  return data || null;
}

export async function getPortalSyncJob({ token, jobId }) {
  if (!supabase || !token || !jobId) return null;

  const { data, error } = await supabase.rpc("app_cpe_get_portal_sync_job", {
    p_token: token,
    p_job_id: jobId
  });

  if (error) throw error;
  return data;
}
