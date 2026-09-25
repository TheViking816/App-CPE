import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260924214448_exchange_conversations_inbox.sql", import.meta.url), "utf8");
const restPanel = readFileSync(new URL("../src/RestExchangePanel.jsx", import.meta.url), "utf8");
const vacationPanel = readFileSync(new URL("../src/VacationExchangePanel.jsx", import.meta.url), "utf8");
const chapaMigration = readFileSync(new URL("../supabase/migrations/20260924220710_exchange_chapa_in_names.sql", import.meta.url), "utf8");
const inbox = readFileSync(new URL("../src/ExchangeConversations.jsx", import.meta.url), "utf8");
const chat = readFileSync(new URL("../src/PrivateExchangeChat.jsx", import.meta.url), "utf8");
const directChat = readFileSync(new URL("../src/DirectConversations.jsx", import.meta.url), "utf8");
const directMigration = readFileSync(new URL("../supabase/migrations/20260925023759_hide_deleted_direct_conversations.sql", import.meta.url), "utf8");
const supportDirectoryMigration = readFileSync(new URL("../supabase/migrations/20260925222249_allow_support_to_view_direct_directory.sql", import.meta.url), "utf8");
const directChapasMigration = readFileSync(new URL("../supabase/migrations/20260925222501_add_chapas_to_direct_chat_tables.sql", import.meta.url), "utf8");
const recipientChapaMigration = readFileSync(new URL("../supabase/migrations/20260925224442_add_recipient_chapa_to_direct_messages.sql", import.meta.url), "utf8");
const readReceiptsMigration = readFileSync(new URL("../supabase/migrations/20260925225217_direct_chat_read_receipts_and_support_review.sql", import.meta.url), "utf8");
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

test("Intercambios se abre primero y los chats entre usuarios se llaman privados", () => {
  assert.match(inbox, /useState\("exchange"\)/);
  assert.ok(inbox.indexOf('>Intercambios</button>') < inbox.indexOf('Chats privados</button>'));
  assert.doesNotMatch(inbox, /Chats entre usuarios/);
});

test("los chats privados vacíos no aparecen y se pueden ocultar sin borrar al otro usuario", () => {
  assert.match(directMigration, /and m\.id is not null/);
  assert.match(directMigration, /m\.created_at > r\.hidden_at/);
  assert.match(directMigration, /create function public\.app_cpe_direct_delete/);
  assert.match(directMigration, /c\.user_low_id = v_user_id or c\.user_high_id = v_user_id/);
  assert.doesNotMatch(directMigration, /delete from public\.app_cpe_direct_messages/);
  assert.match(directChat, /deleteDirectConversation\(/);
  assert.match(directChat, /setSelectedPerson\(\{ id, counterpartName:/);
});

test("la clave maestra revisa chats sin enviar ni marcarlos como leídos", () => {
  assert.match(supportDirectoryMigration, /v_user := public\.app_cpe_user_from_token\(p_token\)/);
  assert.match(supportDirectoryMigration, /v_user_id := private\.app_cpe_direct_actor\(p_token\)/);
  assert.match(directChat, /getDirectThreads\(\{ token: session\.token \}\)/);
  assert.match(directChat, /if \(!session\.supportAccess\) await markDirectRead/);
  assert.match(directChat, /busy \|\| session\.supportAccess \|\| EXCHANGE_PREVIEW_READ_ONLY/);
  assert.match(directChat, /!session\.supportAccess && !EXCHANGE_PREVIEW_READ_ONLY && <form/);
  assert.match(readReceiptsMigration, /create table private\.app_cpe_direct_support_audit/);
  assert.match(readReceiptsMigration, /on conflict \(session_hash, conversation_id\) do update/);
  assert.match(readReceiptsMigration, /v_user := public\.app_cpe_user_from_token\(p_token\)/);
  assert.match(readReceiptsMigration, /if coalesce\(v_is_support, false\) then/);
  assert.doesNotMatch(readReceiptsMigration, /create or replace function public\.app_cpe_direct_send/);
});

test("el administrador no publica su presencia y se identifica con una tarjeta Admin", () => {
  assert.match(supportDirectoryMigration, /'isAdmin', u\.chapa = '72683'/);
  assert.match(supportDirectoryMigration, /'isAdmin', other\.chapa = '72683'/);
  assert.match(supportDirectoryMigration, /case when u\.chapa = '72683' then false/);
  assert.match(supportDirectoryMigration, /case when other\.chapa = '72683' then false/);
  assert.match(directChat, /person\.isAdmin \? <small className="direct-admin-badge">Admin<\/small>/);
  assert.match(directChat, /thread\.isAdmin \? <small className="direct-admin-badge">Admin<\/small>/);
  assert.match(readReceiptsMigration, /\(u\.chapa = '72683'\) desc/);
  assert.match(directChat, /Boolean\(b\.isAdmin\)\) - Number\(Boolean\(a\.isAdmin\)\)/);
});

test("el tick de lectura usa la fecha del destinatario y no la del remitente", () => {
  assert.match(readReceiptsMigration, /r\.user_id = case when c\.user_low_id = v_user\.id then c\.user_high_id else c\.user_low_id end/);
  assert.match(readReceiptsMigration, /v_recipient_read_at >= messages\.created_at/);
  assert.match(directChat, /message\.readAt \? <CheckCheck size=\{14\} \/> : <Check size=\{14\} \/>/);
});

test("los DS de calendario anual solo muestran su código en el selector", () => {
  assert.match(restPanel, /formatDay\(selectedCalendarRest\)\} · DS<\/option>/);
  assert.doesNotMatch(restPanel, /calendario anual/i);
});

test("las tres tablas de chats mantienen chapas legibles además de los IDs", () => {
  for (const column of ["user_low_chapa", "user_high_chapa", "sender_chapa", "user_chapa"]) {
    assert.match(directChapasMigration, new RegExp(`add column ${column} text`));
    assert.match(directChapasMigration, new RegExp(`alter column ${column} set not null`));
  }
  assert.match(directChapasMigration, /before insert or update on public\.app_cpe_direct_conversations/);
  assert.match(directChapasMigration, /before insert or update on public\.app_cpe_direct_messages/);
  assert.match(directChapasMigration, /before insert or update on public\.app_cpe_direct_reads/);
  assert.match(directChapasMigration, /after update of chapa on public\.app_cpe_users/);
});

test("cada mensaje guarda la chapa del otro participante como destinatario", () => {
  assert.match(recipientChapaMigration, /add column recipient_chapa text/);
  assert.match(recipientChapaMigration, /when c\.user_low_id = new\.sender_id then c\.user_high_id/);
  assert.match(recipientChapaMigration, /when c\.user_high_id = new\.sender_id then c\.user_low_id/);
  assert.match(recipientChapaMigration, /alter column recipient_chapa set not null/);
  assert.match(recipientChapaMigration, /and \(c\.user_low_id = new\.id or c\.user_high_id = new\.id\)/);
});
