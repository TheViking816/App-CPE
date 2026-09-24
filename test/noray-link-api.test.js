import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/noray-link.js";

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value = "") { this.body = value; return this; }
  };
}

test("el puente rechaza secciones no verificadas sin consultar credenciales", async () => {
  const result = response();
  await handler({ method: "POST", headers: {}, body: { token: "valid", section: "vacaciones" } }, result);
  assert.equal(result.statusCode, 400);
  assert.equal(result.headers.location, undefined);
});

test("el puente solo redirige al iframe y a la chapa del piloto", async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.VITE_SUPABASE_URL;
  const oldKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  process.env.VITE_SUPABASE_URL = "https://example.supabase.co";
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-key";
  const requested = [];
  globalThis.fetch = async (_url, options) => {
    requested.push(JSON.parse(options.body));
    return new Response(JSON.stringify(
      `https://norayweb.cpevalencia.com/jornales?cal=gwt&mode=PROD&req=login&usr=72683&rec=2611&pwd=${"a".repeat(64)}`
    ), { status: 200 });
  };

  try {
    const result = response();
    await handler({ method: "POST", headers: {}, body: { token: "test-token", section: "jornales" } }, result);
    assert.equal(result.statusCode, 303);
    assert.equal(result.headers["cache-control"], "private, no-store, max-age=0");
    assert.equal(result.headers["referrer-policy"], "no-referrer");
    assert.equal(new URL(result.headers.location).pathname, "/jornales");
    assert.deepEqual(requested, [{ p_token: "test-token", p_section: "jornales" }]);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.VITE_SUPABASE_URL;
    else process.env.VITE_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    else process.env.VITE_SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});
