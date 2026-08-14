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

type SyncJob = { jobId: string; chapa: string };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
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
        "User-Agent": "app-cpe-refresh-all-portals",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({ ref: workflowRef, inputs: { job_id: jobId } })
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub dispatch failed ${response.status}: ${await response.text()}`);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  if (!projectUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "Missing Supabase service configuration" }, 500);
  }
  if (executionMode !== "persistent" && !githubToken) {
    return jsonResponse({ ok: false, error: "Missing GITHUB_SYNC_TOKEN secret" }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Solicitud no valida" }, 400);
  }

  const token = typeof body.token === "string" ? body.token : "";
  const workflowRef = typeof body.ref === "string" && body.ref.trim()
    ? body.ref.trim()
    : defaultWorkflowRef;
  if (!token) return jsonResponse({ ok: false, error: "Sesion no valida" }, 400);

  const supabase = createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });
  const { data, error } = await supabase.rpc("app_cpe_create_admin_portal_sync_jobs", {
    p_token: token
  });

  if (error || data?.ok === false) {
    const forbidden = error?.code === "42501";
    return jsonResponse({
      ok: false,
      error: forbidden ? "Acceso administrativo no autorizado" : error?.message ?? "No se pudo crear la cola"
    }, forbidden ? 403 : 400);
  }

  const jobs: SyncJob[] = Array.isArray(data?.jobs) ? data.jobs : [];
  if (executionMode === "persistent" || jobs.length === 0) {
    return jsonResponse({
      ok: true,
      queued: Number(data?.queued || 0),
      skipped: Number(data?.skipped || 0),
      failed: 0
    }, 202);
  }

  const dispatchResults = await Promise.allSettled(
    jobs.map((job) => dispatchWorkflow(job.jobId, workflowRef))
  );
  const failedJobs = jobs.filter((_, index) => dispatchResults[index].status === "rejected");

  if (failedJobs.length) {
    await Promise.all(failedJobs.map((job) => supabase
      .from("app_cpe_portal_sync_jobs")
      .update({
        status: "failed",
        message: "No se pudo lanzar la sincronizacion",
        portal_password: null,
        security_key: null,
        finished_at: new Date().toISOString()
      })
      .eq("id", job.jobId)));
  }

  const dispatched = jobs.length - failedJobs.length;
  return jsonResponse({
    ok: failedJobs.length === 0,
    queued: dispatched,
    skipped: Number(data?.skipped || 0),
    failed: failedJobs.length,
    error: failedJobs.length ? "Algunas sincronizaciones no se pudieron lanzar" : undefined
  }, failedJobs.length ? 207 : 202);
});
