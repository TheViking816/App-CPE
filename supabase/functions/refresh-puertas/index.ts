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
const workflowId = Deno.env.get("GITHUB_SYNC_WORKFLOW") ?? "sync-puertas.yml";
const minRefreshSeconds = Number(Deno.env.get("MIN_REFRESH_SECONDS") ?? "300");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

async function getLatestSnapshotAgeSeconds() {
  if (!projectUrl || !serviceRoleKey) return null;

  const supabase = createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  const { data, error } = await supabase
    .from("app_cpe_door_snapshots")
    .select("updated_at")
    .eq("specialty", "CONDUCTOR 1a")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.updated_at) return null;

  return Math.floor((Date.now() - new Date(data.updated_at).getTime()) / 1000);
}

async function dispatchWorkflow() {
  const response = await fetch(
    `https://api.github.com/repos/${githubRepo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        "User-Agent": "app-cpe-refresh-puertas",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({ ref: "main" })
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
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!githubToken) {
    return jsonResponse({
      triggered: false,
      configured: false,
      message: "Missing GITHUB_SYNC_TOKEN secret"
    }, 200);
  }

  let force = false;
  try {
    const body = await request.json();
    force = body?.force === true;
  } catch {
    force = false;
  }

  const ageSeconds = await getLatestSnapshotAgeSeconds();
  if (!force && ageSeconds !== null && ageSeconds < minRefreshSeconds) {
    return jsonResponse({
      triggered: false,
      configured: true,
      ageSeconds,
      message: "Latest snapshot is still fresh"
    });
  }

  try {
    await dispatchWorkflow();
    return jsonResponse({
      triggered: true,
      configured: true,
      ageSeconds,
      message: "GitHub sync workflow dispatched"
    }, 202);
  } catch (error) {
    return jsonResponse({
      triggered: false,
      configured: true,
      ageSeconds,
      error: error instanceof Error ? error.message : "Unknown error"
    }, 502);
  }
});
