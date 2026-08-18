import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../src/supabaseClient.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../scripts/sync-portal-oficial-job.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260818121038_add_pending_portal_activation_emails.sql", import.meta.url), "utf8");

test("el registro pide correo y la primera conexión queda pendiente sin lanzar una lectura", () => {
  assert.match(app, /type="email"/);
  assert.match(client, /p_email: email/);
  assert.match(app, /portalActivationStatus === "pending" && !snapshot/);
  assert.match(app, /Cuenta pendiente de activación/);
});

test("la primera sincronización activa la cuenta y encola el correo", () => {
  assert.match(migration, /app_cpe_activate_user_after_first_sync/);
  assert.match(migration, /'user_activated'/);
  assert.match(worker, /sendActivationEmails\(\)/);
  assert.match(client, /portalestiba-push-backend-one\.vercel\.app\/api\/push\/notify-new-hire/);
});
