const PDF_CHUNK_PATTERN = /monthlyPayrollPdf-[A-Za-z0-9_-]+\.js/;
const MODULE_SCRIPT_PATTERN = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/i;

function cacheBustedUrl(url) {
  const refreshed = new URL(url);
  refreshed.searchParams.set("app_cpe_refresh", String(Date.now()));
  return refreshed.href;
}

async function fetchText(fetcher, url) {
  const response = await fetcher(cacheBustedUrl(url), {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" }
  });
  if (!response.ok) throw new Error(`No se pudo cargar ${url} (${response.status})`);
  return response.text();
}

export async function findCurrentMonthlyPayrollPdfUrl({ fetcher, pageUrl }) {
  const appUrl = new URL(import.meta.env?.BASE_URL || "/", pageUrl);
  const html = await fetchText(fetcher, appUrl);
  const scriptSrc = html.match(MODULE_SCRIPT_PATTERN)?.[1];
  if (!scriptSrc) throw new Error("No se encontro el modulo principal actual.");

  const scriptUrl = new URL(scriptSrc, appUrl);
  const scriptSource = await fetchText(fetcher, scriptUrl);
  const chunkFilename = scriptSource.match(PDF_CHUNK_PATTERN)?.[0];
  if (!chunkFilename) throw new Error("No se encontro el modulo PDF actual.");

  return cacheBustedUrl(new URL(chunkFilename, scriptUrl));
}

export async function loadMonthlyPayrollPdfModule({
  initialImporter = () => import("./monthlyPayrollPdf.js"),
  fetcher = globalThis.fetch,
  moduleImporter = (url) => import(/* @vite-ignore */ url),
  pageUrl = globalThis.location?.href || "http://localhost/"
} = {}) {
  try {
    return await initialImporter();
  } catch (initialError) {
    try {
      const currentModuleUrl = await findCurrentMonthlyPayrollPdfUrl({ fetcher, pageUrl });
      return await moduleImporter(currentModuleUrl);
    } catch (recoveryError) {
      console.error("No se pudo recuperar el modulo PDF tras actualizar la app:", recoveryError);
      throw initialError;
    }
  }
}
