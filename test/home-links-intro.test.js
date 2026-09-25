import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("el aviso de Inicio anuncia Enlaces a cada chapa sin depender del antiguo aviso del foro", () => {
  assert.match(app, /LINKS_INTRO_SEEN_KEY = "app-cpe-links-intro-seen-v1"/);
  assert.match(app, /forumStorageKey\(LINKS_INTRO_SEEN_KEY, chapa\)/);
  assert.match(app, /showLinksIntro &&[\s\S]*onNavigate\("enlaces"\)/);
  assert.match(app, /markLinksIntroSeen\(session\.chapa\)/);
  assert.doesNotMatch(app, /showForumIntro|FORUM_INTRO_SEEN_KEY/);
});

test("Conversaciones muestra un aviso por chapa hasta la primera visita", () => {
  assert.match(app, /CONVERSATIONS_INTRO_SEEN_KEY = "app-cpe-conversations-intro-seen-v1"/);
  assert.match(app, /forumStorageKey\(CONVERSATIONS_INTRO_SEEN_KEY, chapa\)/);
  assert.match(app, /showConversationsIntro &&[\s\S]*onNavigate\("conversaciones"\)/);
  assert.match(app, /activeTab !== "conversaciones" && !hasSeenConversationsIntro\(session\.chapa\)/);
  assert.match(app, /markConversationsIntroSeen\(session\.chapa\)/);
});
