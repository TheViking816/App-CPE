import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260925034808_track_conversations_page.sql", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const monitor = readFileSync(new URL("../src/AdminMonitor.jsx", import.meta.url), "utf8");

test("la navegación registra Conversaciones como cualquier otra página", () => {
  assert.match(app, /trackPageVisit\(\{ token: session\.token, page: activeTab \}\)/);
  assert.match(migration, /'foro', 'conversaciones'/g);
  assert.match(migration, /v_is_support_session or v_user\.chapa = '72683'/);
});

test("el monitor presenta los accesos a Conversaciones con su nombre", () => {
  assert.match(monitor, /conversaciones: "Conversaciones"/);
  assert.match(monitor, /PAGE_LABELS\[page\.page\]/);
  assert.match(monitor, /PAGE_LABELS\[user\.lastPage\]/);
});
