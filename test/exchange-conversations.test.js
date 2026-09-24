import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260924214448_exchange_conversations_inbox.sql", import.meta.url), "utf8");
const restPanel = readFileSync(new URL("../src/RestExchangePanel.jsx", import.meta.url), "utf8");
const vacationPanel = readFileSync(new URL("../src/VacationExchangePanel.jsx", import.meta.url), "utf8");
const chapaMigration = readFileSync(new URL("../supabase/migrations/20260924220710_exchange_chapa_in_names.sql", import.meta.url), "utf8");
const inbox = readFileSync(new URL("../src/ExchangeConversations.jsx", import.meta.url), "utf8");
const chat = readFileSync(new URL("../src/PrivateExchangeChat.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("retirar una oferta conserva las propuestas y mensajes como historial", () => {
  assert.match(migration, /update public\.app_cpe_rest_offers set status = 'cancelled'/);
  assert.match(migration, /update public\.app_cpe_vacation_offers set status = 'cancelled'/);
  assert.doesNotMatch(migration, /delete from public\.app_cpe_(rest|vacation)_offers/);
});

test("la bandeja exige sesión y comprueba que el usuario participe en el hilo", () => {
  assert.match(migration, /v_user := public\.app_cpe_user_from_token\(p_token\)/);
  assert.match(migration, /where o\.owner_id = v_user\.id or p\.proposer_id = v_user\.id/g);
  assert.match(migration, /revoke all on public\.app_cpe_exchange_thread_reads from public, anon, authenticated/);
});

test("ambas ofertas abren la conversación unificada en vez de duplicar el chat", () => {
  assert.match(restPanel, /conversationHash\("rest", proposal\.id\)/);
  assert.match(vacationPanel, /conversationHash\("vacation", proposal\.id\)/);
  assert.doesNotMatch(restPanel, /<PrivateExchangeChat/);
  assert.doesNotMatch(vacationPanel, /<PrivateExchangeChat/);
});

test("las burbujas mantienen su altura natural y muestran la chapa de ambos participantes", () => {
  assert.match(styles, /\.rest-exchange-messages \{ display: flex; flex-direction: column; align-items: flex-start;/);
  assert.match(styles, /\.rest-exchange-message \{[^}]*width: fit-content;/);
  assert.match(inbox, /ownChapa=\{session\.chapa\} counterpartChapa=\{selected\.counterpartChapa\}/);
  assert.match(chat, /message\.isOwn \? ownChapa : counterpartChapa/);
});

test("las ofertas y propuestas identifican con chapa al compañero antes del acuerdo", () => {
  assert.match(restPanel, /offer\.ownerChapa/);
  assert.match(vacationPanel, /offer\.ownerChapa/);
  assert.match(restPanel, /proposal\.counterpartChapa \? /);
  assert.match(vacationPanel, /proposal\.counterpartChapa \? /);
  assert.match(chapaMigration, /app_cpe_exchange_threads\(text\)/);
  assert.match(chapaMigration, /app_cpe_rest_exchange_list\(text\)/);
  assert.match(chapaMigration, /app_cpe_vacation_exchange_list\(text\)/);
});
