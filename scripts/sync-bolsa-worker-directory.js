import { syncBolsaWorkerDirectory } from "./bolsa-worker-directory.js";

syncBolsaWorkerDirectory()
  .then(({ total, turnoTotal, observedInAppCpe, assetPath, turnoAssetPath }) => {
    console.log(`OK: ${total} nombres de bolsa guardados (${observedInAppCpe} observados en Donde voy) en Supabase y ${assetPath}; ${turnoTotal} nombres de turno guardados en ${turnoAssetPath}.`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "No se pudo actualizar el directorio de bolsa.");
    process.exitCode = 1;
  });
