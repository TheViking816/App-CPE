import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("admin sync monitor includes every sync job and the administrator chapa", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260903021616_include_all_sync_portal_chapas_in_admin_monitor.sql", import.meta.url),
    "utf8"
  );

  assert.match(sql, /from public\.app_cpe_portal_sync_jobs jobs/);
  assert.match(sql, /full join public\.app_cpe_users users/);
  assert.match(sql, /where jobs\.chapa is not null/);
  assert.match(sql, /coalesce\(users\.chapa, jobs\.chapa\)/);
  assert.doesNotMatch(sql, /users\.chapa <> v_admin\.chapa/);
});
