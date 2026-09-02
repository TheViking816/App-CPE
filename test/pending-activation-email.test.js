import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../src/supabaseClient.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../scripts/sync-portal-oficial-job.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260818121038_add_pending_portal_activation_emails.sql", import.meta.url), "utf8");
const isolationMigration = fs.readFileSync(new URL("../supabase/migrations/20260818130429_isolate_new_registration_portal_state.sql", import.meta.url), "utf8");
const pendingQueueMigration = fs.readFileSync(new URL("../supabase/migrations/20260818132500_queue_pending_portal_activations.sql", import.meta.url), "utf8");
const atomicFirstSyncMigration = fs.readFileSync(new URL("../supabase/migrations/20260822053803_make_first_portal_sync_atomic_and_visible.sql", import.meta.url), "utf8");
const rejectedCredentialsEmailMigration = fs.readFileSync(new URL("../supabase/migrations/20260822054449_email_user_on_rejected_portal_credentials.sql", import.meta.url), "utf8");
const deduplicatedRejectedCredentialsEmailMigration = fs.readFileSync(new URL("../supabase/migrations/20260902010155_deduplicate_rejected_credentials_email.sql", import.meta.url), "utf8");
const currentUserMigration = fs.readFileSync(new URL("../supabase/migrations/20260818133000_refresh_current_app_cpe_user.sql", import.meta.url), "utf8");

test("el registro pide correo y la primera conexión queda pendiente sin lanzar una lectura", () => {
  assert.match(app, /type="email"/);
  assert.match(client, /p_email: email/);
  assert.match(app, /portalActivationStatus === "pending" && !snapshot/);
  assert.match(app, /Cuenta pendiente de activación/);
  assert.match(app, /Te enviaremos un correo a \{session\.email/);
  assert.match(app, /useState\(Boolean\(openCredentialsOnLoad\)\)/);
  assert.doesNotMatch(app, /No necesitas mantener esta pantalla abierta/);
  assert.match(app, /queuePendingPortalActivation\(\{ token: session\.token \}\)/);
  assert.match(pendingQueueMigration, /'activation_pending'/);
  assert.match(pendingQueueMigration, /portal_activation_status = 'pending'/);
  assert.match(app, /refreshCurrentUser\(\{ token: session\.token \}\)/);
  assert.match(app, /window\.setInterval\(refreshActivation, 15_000\)/);
  assert.match(currentUserMigration, /app_cpe_get_current_user/);
  assert.match(app, /pendingActivation \? null : readPortalActiveSync/);
  assert.match(isolationMigration, /app_cpe_purge_stale_portal_state/);
  assert.match(isolationMigration, /delete from public\.app_cpe_portal_sync_jobs/);
});

test("la primera sincronización activa la cuenta y encola el correo", () => {
  assert.match(migration, /app_cpe_activate_user_after_first_sync/);
  assert.match(migration, /'user_activated'/);
  assert.match(worker, /sendActivationEmails\(\)/);
  assert.match(client, /portalestiba-push-backend-one\.vercel\.app\/api\/push\/notify-new-hire/);
});

test("guardar las primeras claves encola la carga anual aunque el navegador se cierre", () => {
  assert.match(atomicFirstSyncMigration, /app_cpe_queue_pending_activation_email/);
  assert.match(atomicFirstSyncMigration, /'activation_pending',[\s\S]*'history'/);
  assert.doesNotMatch(atomicFirstSyncMigration, /delete from public\.app_cpe_portal_sync_jobs/);
  assert.match(atomicFirstSyncMigration, /'failed',[\s\S]*El portal oficial rechazó/);
});

test("el rechazo de las claves avisa al usuario y vuelve a dejar su cuenta pendiente", () => {
  assert.match(rejectedCredentialsEmailMigration, /portal_credentials_rejected/);
  assert.match(rejectedCredentialsEmailMigration, /v_user\.email/);
  assert.match(rejectedCredentialsEmailMigration, /portal_activation_status = 'pending'/);
  assert.match(app, /setShowCredentials\(rejectedCredentials\)/);
});

test("el rechazo repetido de las mismas claves solo encola un correo", () => {
  const retireFunction = deduplicatedRejectedCredentialsEmailMigration.match(
    /create or replace function private\.app_cpe_retire_rejected_portal_credentials\(\)[\s\S]*?revoke all/
  )?.[0] || "";
  assert.match(retireFunction, /on conflict \(user_id, kind\) do nothing/);
  assert.doesNotMatch(retireFunction, /do update set/);
  assert.match(deduplicatedRejectedCredentialsEmailMigration, /app_cpe_reset_rejected_credentials_email/);
  assert.match(deduplicatedRejectedCredentialsEmailMigration, /after insert or update of portal_password_secret_id/);
  assert.match(deduplicatedRejectedCredentialsEmailMigration, /outbox\.kind = 'portal_credentials_rejected'/);
  assert.match(worker, /hasRejectedCredentialsNotice\(job\.chapa\)/);
  assert.match(worker, /el usuario ya fue avisado/);
  assert.match(worker, /clearRejectedCredentialsNotice\(job\.chapa\)/);
});
