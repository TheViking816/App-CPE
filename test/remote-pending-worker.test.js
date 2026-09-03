import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("remote pending worker is restricted, claimed once and runs the existing pending flow", async () => {
  const [sql, agent, installer, monitor, client] = await Promise.all([
    read("../supabase/migrations/20260903022245_remote_pending_worker_control.sql"),
    read("../scripts/remote-pending-worker-agent.js"),
    read("../scripts/windows/install-remote-pending-worker-agent.ps1"),
    read("../src/AdminMonitor.jsx"),
    read("../src/supabaseClient.js")
  ]);
  assert.match(sql, /v_admin\.chapa <> '72683'/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /revoke all on public\.app_cpe_worker_commands from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.app_cpe_claim_worker_command\(text\) to service_role/);
  assert.match(agent, /run-pending-sync\.ps1/);
  assert.match(agent, /app_cpe_claim_worker_command/);
  assert.match(installer, /App CPE - Control remoto pendientes/);
  assert.match(monitor, /Ejecutar pendientes en el PC/);
  assert.match(client, /app_cpe_admin_request_pending_worker/);
});
