import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("desktop launchers explicitly select full history or current month", async () => {
  const [queue, powershell, installer] = await Promise.all([
    read("../scripts/queue-all-portal-syncs.js"),
    read("../scripts/windows/queue-all-portal-syncs.ps1"),
    read("../scripts/windows/install-queue-all-shortcut.ps1")
  ]);
  assert.match(queue, /--full-history/);
  assert.match(queue, /--current-month/);
  assert.match(queue, /p_full_history: fullHistory/);
  assert.match(powershell, /ValidateSet\("FullHistory", "CurrentMonth"\)/);
  assert.match(powershell, /\[int\]\$BatchSize = 6/);
  assert.match(powershell, /-BatchSize \$BatchSize -Drain/);
  assert.match(powershell, /tandas de hasta \$BatchSize/);
  assert.match(installer, /Carga completa anual \(todos\)/);
  assert.match(installer, /Actualizar mes actual \(todos\)/);
});

test("manual all-users RPC forces the requested synchronization mode", async () => {
  const migration = await read("../supabase/migrations/20260819063907_split_worker_full_and_current_sync.sql");
  assert.match(migration, /p_full_history boolean default false/);
  assert.match(migration, /case when p_full_history then 'history' else 'snapshot' end/);
  assert.match(migration, /set request_kind = 'history'/);
  assert.match(migration, /grant execute on function public\.app_cpe_create_worker_manual_jobs\(boolean\) to service_role/);
});

test("portal worker preserves request_kind while claiming a batch", async () => {
  const worker = await read("../scripts/portal-sync-worker.js");
  const claim = worker.match(/async function claimNextBatch\(\)[\s\S]*?return claimed \|\| \[\];/)?.[0] || "";
  assert.match(claim, /request_kind/);
});

test("desktop current-month sync refreshes only the latest payroll document", async () => {
  const [job, sync] = await Promise.all([
    read("../scripts/sync-portal-oficial-job.js"),
    read("../scripts/sync-portal-oficial.js")
  ]);
  assert.match(job, /trigger_source === "worker_manual_all" && job\.request_kind === "snapshot"/);
  assert.match(job, /CPE_PORTAL_REFRESH_LATEST_PAYROLL/);
  assert.match(sync, /result\.rows\.slice\(0, 1\)/);
  assert.match(sync, /mergePayrollHistory/);
  assert.match(sync, /"ultima nomina"/);
});
