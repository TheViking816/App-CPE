import assert from "node:assert/strict";
import test from "node:test";
import {
  findCurrentMonthlyPayrollPdfUrl,
  loadMonthlyPayrollPdfModule
} from "../src/loadMonthlyPayrollPdf.js";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body
  };
}

test("resuelve el chunk PDF del despliegue actual sin usar cache", async () => {
  const requested = [];
  const fetcher = async (url, options) => {
    requested.push({ url: String(url), options });
    if (requested.length === 1) {
      return response('<script type="module" crossorigin src="/assets/index-nuevo.js"></script>');
    }
    return response('const pdfChunk="monthlyPayrollPdf-nuevo123.js";');
  };

  const url = await findCurrentMonthlyPayrollPdfUrl({
    fetcher,
    pageUrl: "https://cpe-app-flax.vercel.app/#/portal"
  });

  assert.match(url, /^https:\/\/cpe-app-flax\.vercel\.app\/assets\/monthlyPayrollPdf-nuevo123\.js\?/);
  assert.equal(requested.length, 2);
  assert.ok(requested.every(({ options }) => options.cache === "no-store"));
});

test("recupera la descarga si el chunk de una pestana antigua devuelve 404", async () => {
  const expectedModule = { downloadMonthlyPayrollPdf() {} };
  let importedUrl = "";
  const result = await loadMonthlyPayrollPdfModule({
    initialImporter: async () => { throw new TypeError("Failed to fetch dynamically imported module"); },
    pageUrl: "https://cpe-app-flax.vercel.app/#/portal",
    fetcher: async (url) => String(url).includes("index-nuevo.js")
      ? response('"monthlyPayrollPdf-actual456.js"')
      : response('<script type="module" src="/assets/index-nuevo.js"></script>'),
    moduleImporter: async (url) => {
      importedUrl = url;
      return expectedModule;
    }
  });

  assert.equal(result, expectedModule);
  assert.match(importedUrl, /\/assets\/monthlyPayrollPdf-actual456\.js\?/);
});
