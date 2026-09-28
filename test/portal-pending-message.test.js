import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PORTAL_PENDING_MESSAGE_EXIT_CODE,
  PortalPendingMessageError,
  hasPendingPortalMessageHeading
} from "../scripts/portal-pending-message.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("reconoce el aviso que bloquea la navegacion sin aceptar el mensaje", () => {
  assert.equal(hasPendingPortalMessageHeading("TIENE 1 MENSAJE NUEVO"), true);
  assert.equal(hasPendingPortalMessageHeading("TIENE 2 MENSAJES NUEVOS"), true);
  assert.equal(hasPendingPortalMessageHeading("Consultas de jornales"), false);
  assert.equal(PORTAL_PENDING_MESSAGE_EXIT_CODE, 76);
  assert.equal(new PortalPendingMessageError().code, "PORTAL_PENDING_MESSAGE");
  const reader = source("../scripts/sync-portal-oficial.js");
  assert.match(reader, /hasPendingPortalMessageHeading\(body\)/);
  assert.match(reader, /if \(outcome\.error\?\.code === "PORTAL_PENDING_MESSAGE"\) throw outcome\.error/);
  assert.doesNotMatch(reader, /acceptButton\.click\(/);
});

test("cierra solo ese trabajo y no programa el reintento inmediato", () => {
  const job = source("../scripts/sync-portal-oficial-job.js");
  const worker = source("../scripts/portal-sync-worker.js");
  assert.match(job, /code === PORTAL_PENDING_MESSAGE_EXIT_CODE/);
  assert.match(job, /status: "failed"/);
  const pendingBranch = worker.split("if (code === PORTAL_PENDING_MESSAGE_EXIT_CODE) {")[1]?.split("if (failureMessage")[0] || "";
  assert.match(pendingBranch, /failRunningJob/);
  assert.doesNotMatch(pendingBranch, /scheduleAutomaticRetry/);
});
