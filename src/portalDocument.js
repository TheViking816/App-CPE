const DEFAULT_STATUS = "Descargando esta nómina del portal...";
const RETRY_STATUS = "El portal está tardando. Reintentando la descarga...";

export function portalPayrollFileName(title) {
  const safeTitle = String(title || "nomina")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${safeTitle || "nomina"}.pdf`;
}

export async function loadPortalPayrollDocument({
  getDocument,
  requestDocument,
  getJob,
  isActive = () => true,
  onStatus = () => {},
  wait = () => new Promise((resolve) => window.setTimeout(resolve, 1500)),
  now = () => Date.now(),
  timeoutMs = 90000,
  maxAttempts = 2
}) {
  let document = await getDocument();
  if (document?.contentBase64) return document;

  const deadline = now() + timeoutMs;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts && isActive() && now() < deadline; attempt += 1) {
    onStatus(attempt === 0 ? DEFAULT_STATUS : RETRY_STATUS);
    const job = await requestDocument();
    if (!job?.jobId) throw new Error("No se pudo iniciar la descarga de la nómina.");

    while (isActive() && now() < deadline) {
      // Another attempt (or another open tab) may have stored the PDF even if
      // this particular job failed, so the document always wins over job state.
      document = await getDocument();
      if (document?.contentBase64) return document;

      const jobStatus = await getJob(job.jobId);
      if (jobStatus?.status === "failed") {
        lastError = new Error(jobStatus.message || "No se pudo descargar la nómina.");
        break;
      }
      if (jobStatus?.status === "completed") {
        lastError = new Error("El portal no devolvió el PDF de esta nómina.");
        break;
      }

      await wait();
    }
  }

  if (!isActive()) return null;
  document = await getDocument();
  if (document?.contentBase64) return document;
  if (now() >= deadline) throw new Error("La descarga de la nómina ha tardado demasiado.");
  throw lastError || new Error("No se pudo descargar la nómina.");
}
