import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("rejected portal access reopens the editable email and credentials form", async () => {
  const app = await read("../src/App.jsx");
  assert.match(app, /hasRejectedPortalCredentials\(data\)/);
  assert.match(app, /setShowCredentials\(!data\?\.payload \|\| rejectedCredentials\)/);
  assert.match(app, /!securityKeyOnly && \(!autoSyncEnabled \|\| !session\.email\)/);
  assert.match(app, /Correo electrónico para avisarte del alta/);
  assert.match(app, /requiresActivationRequest \|\| \(currentSession\.portalActivationStatus === "pending"/);
  assert.match(app, /if \(!job\)[\s\S]{0,400}status\?\.enabled === false[\s\S]{0,400}await loadSnapshot\(\)/);
});

test("replacement credentials create a fresh pending activation request", async () => {
  const sql = await read("../supabase/migrations/20260819090000_reopen_rejected_portal_access.sql");
  assert.match(sql, /set portal_activation_status = 'pending'/);
  assert.match(sql, /portal_activation_status <> 'pending' and v_has_enabled_access/);
  assert.match(sql, /kind in \('admin_pending', 'user_activated'\)/);
  assert.match(sql, /app_cpe_public_user\(v_updated, p_token\)/);
});
