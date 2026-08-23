import { spawn } from "node:child_process";
import {
  resolveSupabaseAdminKey,
  supabaseAdminHeaders,
} from "./supabase-admin.js";

const defaultProjectRef = "wvwdiywtlbffumshbboa";
const jobId = process.env.CPE_PORTAL_SYNC_JOB_ID || process.argv[2];
const supabaseUrl = resolveSupabaseUrl(process.env.CPE_SUPABASE_URL);
const serviceRole = resolveSupabaseAdminKey();

function resolveSupabaseUrl(value) {
  const firstLine =
    String(value || "")
      .replace(/\r|\n/g, "")
      .trim()
      .split(/\s+/)[0] || defaultProjectRef;

  if (/^https?:\/\//i.test(firstLine)) {
    try {
      return new URL(firstLine).origin;
    } catch {
      return `https://${defaultProjectRef}.supabase.co`;
    }
  }

  if (/^[a-z0-9]{20}$/i.test(firstLine))
    return `https://${firstLine}.supabase.co`;
  return `https://${defaultProjectRef}.supabase.co`;
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: supabaseAdminHeaders(serviceRole, {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Supabase HTTP ${response.status}: ${await response.text()}`,
    );
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function updateJob(patch) {
  await supabaseRequest(
    `/rest/v1/app_cpe_portal_sync_jobs?id=eq.${encodeURIComponent(jobId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    },
  );
}

async function closeSnapshotWithError(job, message) {
  if (!job?.chapa || job.request_kind === "document") return;
  const rows = await supabaseRequest(
    `/rest/v1/app_cpe_portal_snapshots?select=payload&chapa=eq.${encodeURIComponent(job.chapa)}&limit=1`,
  );
  const payload = rows?.[0]?.payload || {};
  await supabaseRequest(
    `/rest/v1/app_cpe_portal_snapshots?chapa=eq.${encodeURIComponent(job.chapa)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        payload: {
          ...payload,
          sync: {
            ...(payload.sync || {}),
            inProgress: false,
            failed: true,
            partial: true,
            stage: "No se pudo conectar con el portal",
            error: message,
          },
        },
        updated_at: new Date().toISOString(),
      }),
    },
  );
}

async function hasSavedJornales(chapa) {
  const rows = await supabaseRequest(
    `/rest/v1/app_cpe_portal_snapshots?select=payload&chapa=eq.${encodeURIComponent(chapa)}&limit=1`,
  );
  const jornales = rows?.[0]?.payload?.jornales;
  return (
    Boolean(
      jornales?.recognized && String(jornales?.monthLabel || "").trim(),
    ) ||
    (Array.isArray(jornales?.history) &&
      jornales.history.some(
        (period) =>
          String(period?.monthLabel || "").trim() &&
          Array.isArray(period?.rows),
      ))
  );
}

async function runSync(job) {
  const canUseFastMode =
    job.trigger_source !== "scheduled" &&
    job.request_kind !== "history" &&
    (await hasSavedJornales(job.chapa));

  return new Promise((resolve, reject) => {
    let diagnostic = "";
    const child = spawn(process.execPath, ["scripts/sync-portal-oficial.js"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CPE_PORTAL_USER: job.chapa,
        CPE_PORTAL_PASSWORD: job.portal_password,
        CPE_PORTAL_SECURITY_KEY: job.security_key || "",
        CPE_PORTAL_DOCUMENT_ID: job.document_id || "",
        CPE_PORTAL_REQUEST_KIND: job.request_kind || "snapshot",
        CPE_PORTAL_FAST_MODE: canUseFastMode ? "true" : "false",
        CPE_PORTAL_REFRESH_HISTORY:
          job.request_kind === "history"
            ? "true"
            : process.env.CPE_PORTAL_REFRESH_HISTORY || "",
        CPE_PORTAL_REFRESH_LATEST_PAYROLL:
          job.trigger_source === "worker_manual_all" && job.request_kind === "snapshot"
            ? "true"
            : process.env.CPE_PORTAL_REFRESH_LATEST_PAYROLL || "",
        CPE_PORTAL_HEADLESS: process.env.CPE_PORTAL_HEADLESS || "false",
        CPE_PORTAL_BROWSER_CHANNEL:
          process.env.CPE_PORTAL_BROWSER_CHANNEL || "bundled",
      },
    });

    const redact = (value) => {
      let text = String(value || "");
      for (const secret of [job.portal_password, job.security_key]) {
        if (secret) text = text.split(secret).join("[REDACTED]");
      }
      return text;
    };

    const forward = (stream, target, deferOutput = false) => {
      stream.on("data", (chunk) => {
        const text = chunk.toString();
        diagnostic = `${diagnostic}${text}`.slice(-4000);
        if (!deferOutput) target.write(redact(text));
      });
    };

    forward(child.stdout, process.stdout);
    forward(child.stderr, process.stderr, true);

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else {
        const safeDiagnostic = redact(diagnostic.trim());
        if (safeDiagnostic) process.stderr.write(`${safeDiagnostic}\n`);
        reject(
          new Error(
            safeDiagnostic || `sync-portal-oficial.js exited with code ${code}`,
          ),
        );
      }
    });
  });
}

function publicErrorMessage(error) {
  const message = error instanceof Error ? error.message : "Error desconocido";
  if (/usuario\s+o\s+contrase(?:n|ñ)a\s+del\s+portal\s+oficial\s+incorrectos/i.test(message)) {
    return "Usuario o contraseña del portal oficial incorrectos.";
  }
  return (
    "La actualización no se ha completado. Se volverá a intentar en la próxima sincronización."
  );
}

async function sendActivationEmails() {
  const response = await fetch(
    "https://portalestiba-push-backend-one.vercel.app/api/push/notify-new-hire",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_cpe_activation_emails: true }),
    },
  );
  if (!response.ok)
    console.warn(
      `No se pudo enviar el correo de activación (HTTP ${response.status}).`,
    );
}

async function main() {
  if (!jobId) throw new Error("Missing CPE_PORTAL_SYNC_JOB_ID");
  if (!serviceRole)
    throw new Error(
      "Missing CPE_SUPABASE_SECRET_KEY or CPE_SUPABASE_SERVICE_ROLE",
    );

  const rows = await supabaseRequest(
    `/rest/v1/app_cpe_portal_sync_jobs?select=id,chapa,portal_password,security_key,status,expires_at,trigger_source,request_kind,document_id&id=eq.${encodeURIComponent(jobId)}&limit=1`,
  );
  const job = rows?.[0];
  if (!job) throw new Error("Portal sync job not found");

  if (!job.portal_password) {
    throw new Error("Portal sync job has no credentials");
  }

  if (new Date(job.expires_at).getTime() < Date.now()) {
    const expiredMessage =
      "La sincronizacion ha caducado. Vuelve a lanzar la lectura.";
    await updateJob({
      status: "failed",
      message: expiredMessage,
      portal_password: null,
      security_key: null,
      finished_at: new Date().toISOString(),
    });
    await closeSnapshotWithError(job, expiredMessage);
    throw new Error("Portal sync job expired");
  }

  await updateJob({
    status: "running",
    message:
      job.request_kind === "document"
        ? "Descargando nomina segura"
        : "Leyendo portal oficial",
    started_at: new Date().toISOString(),
  });

  try {
    await runSync(job);
    await updateJob({
      status: "completed",
      message: "Portal sincronizado",
      portal_password: null,
      security_key: null,
      finished_at: new Date().toISOString(),
    });
    await sendActivationEmails().catch(() => {});
  } catch (error) {
    const message = publicErrorMessage(error);
    await updateJob({
      status: "failed",
      message,
      portal_password: null,
      security_key: null,
      finished_at: new Date().toISOString(),
    });
    await closeSnapshotWithError(job, message);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Error desconocido");
  process.exitCode = 1;
});
