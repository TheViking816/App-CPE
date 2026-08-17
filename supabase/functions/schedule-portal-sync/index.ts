import { createClient } from "https://esm.sh/@supabase/supabase-js@2.109.0";

const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  ?? Deno.env.get("CPE_SUPABASE_SERVICE_ROLE")
  ?? "";
const githubToken = Deno.env.get("GITHUB_SYNC_TOKEN") ?? "";
const githubRepo = Deno.env.get("GITHUB_SYNC_REPO") ?? "TheViking816/App-CPE";
const workflowId = Deno.env.get("GITHUB_PORTAL_BATCH_WORKFLOW") ?? "sync-portals-batch.yml";
const workflowRef = Deno.env.get("GITHUB_SYNC_REF") ?? "main";
const executionMode = (Deno.env.get("CPE_PORTAL_EXECUTION_MODE") ?? "actions").toLowerCase();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function dispatchWorkflow(jobIds: string[]) {
  const response = await fetch(
    `https://api.github.com/repos/${githubRepo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        "User-Agent": "app-cpe-scheduled-portal-sync",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({ ref: workflowRef, inputs: { job_ids: jobIds.join(",") } })
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub dispatch failed ${response.status}: ${await response.text()}`);
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  const schedulerSecret = request.headers.get("x-scheduler-secret") ?? "";
  if (!schedulerSecret || !projectUrl || !serviceRoleKey || (executionMode !== "persistent" && !githubToken)) {
    return jsonResponse({ ok: false, error: "Scheduler no configurado" }, 401);
  }

  const supabase = createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  const { data, error } = await supabase.rpc("app_cpe_claim_scheduled_portal_sync_jobs", {
    p_scheduler_secret: schedulerSecret
  });

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 401);
  }

  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  const jobIds = jobs.map((job) => String(job.jobId)).filter(Boolean);
  const results: Array<{ jobId: string; ok: boolean; executionMode: string; error?: string }> = jobs.map((job) => ({
    jobId: String(job.jobId),
    ok: true,
    executionMode
  }));

  try {
    // Una sola Action procesa el lote en serie. Lanzar una Action por chapa hace
    // que el portal oficial bloquee todas las sesiones concurrentes.
    if (executionMode !== "persistent" && jobIds.length > 0) {
      await dispatchWorkflow(jobIds);
    }
  } catch (dispatchError) {
    const message = dispatchError instanceof Error ? dispatchError.message : "No se pudo lanzar GitHub Actions";
    if (jobIds.length > 0) {
      await supabase
        .from("app_cpe_portal_sync_jobs")
        .update({
          status: "failed",
          message,
          portal_password: null,
          security_key: null,
          finished_at: new Date().toISOString()
        })
        .in("id", jobIds);
    }
    for (const result of results) {
      result.ok = false;
      result.error = message;
    }
  }

  return jsonResponse({
    ok: results.every((result) => result.ok),
    skipped: Boolean(data?.skipped),
    slot: data?.slot ?? null,
    dispatched: results.filter((result) => result.ok).length,
    results
  });
});
