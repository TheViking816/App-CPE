import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/noray-link.js";

test("abre vacaciones y excluir jornadas con un enlace personal generado por el servidor", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.VITE_SUPABASE_URL;
  const previousKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  process.env.VITE_SUPABASE_URL = "https://exampleproject.supabase.co";
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  const sections = [];
  globalThis.fetch = async (_url, options) => {
    const { p_section } = JSON.parse(options.body);
    sections.push(p_section);
    return {
      ok: true,
      json: async () => `https://norayweb.cpevalencia.com/${p_section}?cal=gwt&mode=PROD&req=login&usr=12345&rec=2611&pwd=${"a".repeat(64)}`
    };
  };

  try {
    for (const section of ["vacaciones", "excluir-jornadas"]) {
      const headers = {};
      const response = {
        statusCode: 0,
        setHeader(name, value) { headers[name] = value; },
        end() {}
      };
      await handler({
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: "session-test", section })
      }, response);
      assert.equal(response.statusCode, 303);
      assert.equal(new URL(headers.location).pathname, `/${section}`);
      assert.equal(headers["referrer-policy"], "no-referrer");
      assert.equal(headers["cache-control"], "private, no-store, max-age=0");
    }
    assert.deepEqual(sections, ["vacaciones", "excluir-jornadas"]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.VITE_SUPABASE_URL;
    else process.env.VITE_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    else process.env.VITE_SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});
