import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../scripts/bolsa-name-scan-worker.js", import.meta.url), "utf8");
const job = await readFile(new URL("../scripts/bolsa-name-scan-job.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260830085922_bolsa_name_scan_worker.sql", import.meta.url), "utf8");
const chapaConstraintMigration = await readFile(new URL("../supabase/migrations/20260831154215_allow_all_valid_chapas_in_bolsa_name_scan.sql", import.meta.url), "utf8");
const portalWorker = await readFile(new URL("../scripts/portal-sync-worker.js", import.meta.url), "utf8");

test("el rastreador de nombres usa una cola independiente", () => {
  assert.match(migration, /app_cpe_bolsa_name_scan_jobs/);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /enable row level security/i);
  assert.doesNotMatch(portalWorker, /bolsa-name-scan-worker|app_cpe_bolsa_name_scan_jobs/);
});

test("la cola admite cualquier chapa valida de cinco cifras", () => {
  assert.match(chapaConstraintMigration, /\^\[0-9\]\{5\}\$/);
  assert.doesNotMatch(chapaConstraintMigration, /\^7\[0-9\]/);
});

test("el lector abre Jornadas contratadas y solo conserva chapas 80xxx", () => {
  assert.match(job, /User,ViewContractings,,1/);
  assert.match(job, /ParteA\.asp/);
  assert.match(job, /\^80\\d\{3\}\$/);
  assert.match(job, /PERSONAL DE BOLSA/);
});

test("el nombre oficial del parte sustituye siempre al alias de PortalEstibaVLC", () => {
  assert.match(job, /previous\.source === "portalestibavlc"/);
  assert.match(job, /source: "app_cpe"/);
});

test("el resumen final imprime nombres nuevos y nombres mejorados", () => {
  assert.match(worker, /Chapas y nombres NUEVOS guardados/);
  assert.match(worker, /Nombres existentes MEJORADOS/);
  assert.match(worker, /new_workers,updated_workers/);
});

test("las credenciales se borran al cerrar cada trabajo", () => {
  assert.match(migration, /portal_password = null/);
  assert.match(migration, /security_key = null/);
});
