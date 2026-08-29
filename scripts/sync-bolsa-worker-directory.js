import { syncBolsaWorkerDirectory } from "./bolsa-worker-directory.js";

syncBolsaWorkerDirectory()
  .then(({ total, observedInAppCpe, assetPath }) => {
    console.log(`OK: ${total} nombres de bolsa guardados (${observedInAppCpe} observados en Donde voy) en Supabase y ${assetPath}.`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "No se pudo actualizar el directorio de bolsa.");
    process.exitCode = 1;
  });
