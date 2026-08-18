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
const githubToken = Deno.env.get("GITHUB_SYNC_TOKEN") ?? "";
const githubRepo = Deno.env.get("GITHUB_SYNC_REPO") ?? "TheViking816/App-CPE";
const workflowId = Deno.env.get("GITHUB_PORTAL_SYNC_WORKFLOW") ?? "sync-portal.yml";
const defaultWorkflowRef = Deno.env.get("GITHUB_SYNC_REF") ?? "main";
const executionMode = (Deno.env.get("CPE_PORTAL_EXECUTION_MODE") ?? "actions").toLowerCase();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

async function dispatchWorkflow(jobId: string, workflowRef: string) {
  const response = await fetch(
    `https://api.github.com/repos/${githubRepo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        "User-Agent": "app-cpe-refresh-portal",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({ ref: workflowRef, inputs: { job_id: jobId } })
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub dispatch failed ${response.status}: ${detail}`);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  if (!projectUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, configured: false, error: "Missing Supabase service configuration" }, 500);
  }

  if (executionMode !== "persistent" && !githubToken) {
    return jsonResponse({ ok: false, configured: false, error: "Missing GITHUB_SYNC_TOKEN secret" }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Solicitud no valida" }, 400);
  }

  const token = typeof body.token === "string" ? body.token : "";
  const portalPassword = typeof body.portalPassword === "string" ? body.portalPassword : "";
  const securityKey = typeof body.securityKey === "string" ? body.securityKey : "";
  const workflowRef = typeof body.ref === "string" && body.ref.trim() ? body.ref.trim() : defaultWorkflowRef;
  const requestKind = body.requestKind === "document"
    ? "document"
    : body.requestKind === "history"
      ? "history"
      : body.requestKind === "payrolls" ? "payrolls" : "snapshot";
  const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";

  if (!token) {
    return jsonResponse({ ok: false, error: "Sesion no valida" }, 400);
  }

  const supabase = createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  const cooldownStart = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: recentBlock } = executionMode === "persistent" ? { data: null } : await supabase
    .from("app_cpe_portal_sync_jobs")
    .select("finished_at")
    .eq("status", "failed")
    .ilike("message", "%bloqueado temporalmente%")
    .gte("finished_at", cooldownStart)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentBlock) {
    return jsonResponse({
      ok: false,
      portalBlocked: true,
      error: "El portal oficial mantiene activa su verificacion de seguridad. La app volvera a intentarlo automaticamente cuando termine el periodo de proteccion."
    });
  }

  const { data, error } = requestKind === "document"
    ? await supabase.rpc("app_cpe_create_portal_document_job", {
        p_token: token,
        p_document_id: documentId
      })
    : portalPassword
      ? await supabase.rpc("app_cpe_create_portal_sync_job", {
        p_token: token,
        p_portal_password: portalPassword,
        p_security_key: securityKey
      })
      : await supabase.rpc("app_cpe_create_portal_sync_job_from_saved", {
        p_token: token
      });

  if (error || !data?.jobId) {
    return jsonResponse({ ok: false, error: error?.message ?? "No se pudo crear la sincronizacion" }, 400);
  }

  if (requestKind !== "document") {
    const { data: jobRow } = await supabase
      .from("app_cpe_portal_sync_jobs")
      .select("chapa")
      .eq("id", data.jobId)
      .maybeSingle();
    if (jobRow?.chapa) {
      const { data: existingSnapshot } = await supabase
        .from("app_cpe_portal_snapshots")
        .select("chapa")
        .eq("chapa", jobRow.chapa)
        .maybeSingle();
      if (!existingSnapshot) {
        await supabase.from("app_cpe_portal_snapshots").insert({
          chapa: jobRow.chapa,
          source: "https://portal.cpevalencia.com/#User",
          payload: {
            sync: {
              inProgress: true,
              stage: "Conectando con el portal",
              partial: false,
              freshSections: 0,
              warnings: []
            }
          },
          updated_at: new Date().toISOString()
        });
      }
    }
  }

  if (["history", "payrolls"].includes(requestKind)) {
    const { error: kindError } = await supabase
      .from("app_cpe_portal_sync_jobs")
      .update({
        request_kind: requestKind,
        message: requestKind === "history" ? "Preparando historial anual" : "Preparando nominas"
      })
      .eq("id", data.jobId);
    if (kindError) {
      return jsonResponse({ ok: false, error: kindError.message }, 400);
    }
  }

  try {
    if (executionMode !== "persistent") {
      await dispatchWorkflow(data.jobId, workflowRef);
    }
    return jsonResponse({
      ok: true,
      configured: true,
      triggered: executionMode !== "persistent",
      executionMode,
      jobId: data.jobId,
      status: "queued",
      workflowRef
    }, 202);
  } catch (dispatchError) {
    await supabase
      .from("app_cpe_portal_sync_jobs")
      .update({
        status: "failed",
        message: dispatchError instanceof Error ? dispatchError.message : "No se pudo lanzar GitHub Actions",
        portal_password: null,
        security_key: null,
        finished_at: new Date().toISOString()
      })
      .eq("id", data.jobId);

    return jsonResponse({
      ok: false,
      configured: true,
      jobId: data.jobId,
      error: dispatchError instanceof Error ? dispatchError.message : "No se pudo lanzar GitHub Actions"
    });
  }
});
