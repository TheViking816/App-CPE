import test from "node:test";
import assert from "node:assert/strict";

import { loadPortalPayrollDocument, portalPayrollFileName } from "../src/portalDocument.js";

const noWait = async () => {};

test("genera un nombre de archivo válido para Android", () => {
  assert.equal(portalPayrollFileName("Anticipo 1-15 07/26"), "Anticipo 1-15 07-26.pdf");
});

test("devuelve inmediatamente una nómina que ya está guardada", async () => {
  const document = { contentBase64: "pdf" };
  const result = await loadPortalPayrollDocument({
    getDocument: async () => document,
    requestDocument: async () => assert.fail("no debe crear un trabajo"),
    getJob: async () => assert.fail("no debe consultar un trabajo"),
    wait: noWait
  });
  assert.equal(result, document);
});

test("el documento guardado por otro intento prevalece sobre un trabajo fallido", async () => {
  let reads = 0;
  const document = { contentBase64: "pdf-recuperado" };
  const result = await loadPortalPayrollDocument({
    getDocument: async () => (++reads >= 2 ? document : null),
    requestDocument: async () => ({ jobId: "job-1" }),
    getJob: async () => ({ status: "failed", message: "fallo del portal" }),
    wait: noWait
  });
  assert.equal(result, document);
});

test("reintenta automáticamente una vez cuando falla el portal", async () => {
  let requests = 0;
  let activeJob = "";
  const statuses = [];
  const result = await loadPortalPayrollDocument({
    getDocument: async () => activeJob === "job-2" ? { contentBase64: "pdf" } : null,
    requestDocument: async () => {
      requests += 1;
      activeJob = `job-${requests}`;
      return { jobId: activeJob };
    },
    getJob: async () => ({ status: "failed", message: "fallo temporal" }),
    onStatus: (status) => statuses.push(status),
    wait: noWait
  });
  assert.equal(result.contentBase64, "pdf");
  assert.equal(requests, 2);
  assert.match(statuses.at(-1), /Reintentando/);
});

test("conserva el error real después de agotar los reintentos", async () => {
  await assert.rejects(
    loadPortalPayrollDocument({
      getDocument: async () => null,
      requestDocument: async () => ({ jobId: "job" }),
      getJob: async () => ({ status: "failed", message: "No se pudo abrir el portal seguro" }),
      wait: noWait
    }),
    /No se pudo abrir el portal seguro/
  );
});
