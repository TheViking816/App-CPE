import test from "node:test";
import assert from "node:assert/strict";
import { resolveSupabaseAdminKey, supabaseAdminHeaders } from "../scripts/supabase-admin.js";

test("prefers a dedicated secret key", () => {
  assert.equal(resolveSupabaseAdminKey({
    CPE_SUPABASE_SECRET_KEY: "sb_secret_worker",
    CPE_SUPABASE_SERVICE_ROLE: "legacy"
  }), "sb_secret_worker");
});

test("does not send sb_secret keys as bearer JWTs", () => {
  assert.deepEqual(supabaseAdminHeaders("sb_secret_worker"), {
    apikey: "sb_secret_worker"
  });
});

test("keeps Authorization for legacy service role JWTs", () => {
  assert.deepEqual(supabaseAdminHeaders("legacy.jwt"), {
    apikey: "legacy.jwt",
    Authorization: "Bearer legacy.jwt"
  });
});
