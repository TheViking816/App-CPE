-- The recipient is the other participant in the message's conversation.
-- Keep the user IDs as the authoritative relationships; this is a readable label.
alter table public.app_cpe_direct_messages add column recipient_chapa text;

create or replace function private.app_cpe_direct_message_chapa()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.sender_chapa := (select u.chapa from public.app_cpe_users u where u.id = new.sender_id);
  new.recipient_chapa := (
    select recipient.chapa
    from public.app_cpe_direct_conversations c
    join public.app_cpe_users recipient
      on recipient.id = case
        when c.user_low_id = new.sender_id then c.user_high_id
        when c.user_high_id = new.sender_id then c.user_low_id
        else null
      end
    where c.id = new.conversation_id
  );
  if new.recipient_chapa is null then
    raise exception 'El remitente no pertenece a esta conversación';
  end if;
  return new;
end;
$$;

-- A changed chapa must refresh both messages sent by and messages addressed to
-- that user. The existing message trigger derives both labels again.
create or replace function private.app_cpe_direct_refresh_chapas()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.app_cpe_direct_conversations
    set user_low_chapa = case when user_low_id = new.id then new.chapa else user_low_chapa end,
        user_high_chapa = case when user_high_id = new.id then new.chapa else user_high_chapa end
    where user_low_id = new.id or user_high_id = new.id;
  update public.app_cpe_direct_messages m
    set sender_chapa = m.sender_chapa
    from public.app_cpe_direct_conversations c
    where m.conversation_id = c.id
      and (c.user_low_id = new.id or c.user_high_id = new.id);
  update public.app_cpe_direct_reads set user_chapa = new.chapa where user_id = new.id;
  return new;
end;
$$;

update public.app_cpe_direct_messages set recipient_chapa = recipient_chapa;
alter table public.app_cpe_direct_messages alter column recipient_chapa set not null;

comment on table public.app_cpe_direct_messages is
  'Mensajes de cada conversación privada. sender_chapa identifica al autor y recipient_chapa al otro participante.';
comment on column public.app_cpe_direct_messages.recipient_chapa is
  'Chapa del destinatario: el participante de la conversación distinto de sender_id.';
