-- User IDs remain the authoritative relationships. Chapa columns make each
-- row understandable in the Supabase table editor without joining users.
alter table public.app_cpe_direct_conversations
  add column user_low_chapa text,
  add column user_high_chapa text;
alter table public.app_cpe_direct_messages
  add column sender_chapa text;
alter table public.app_cpe_direct_reads
  add column user_chapa text;

create function private.app_cpe_direct_conversation_chapas()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.user_low_chapa := (select u.chapa from public.app_cpe_users u where u.id = new.user_low_id);
  new.user_high_chapa := (select u.chapa from public.app_cpe_users u where u.id = new.user_high_id);
  return new;
end;
$$;
create trigger app_cpe_direct_conversation_chapas_trigger
before insert or update on public.app_cpe_direct_conversations
for each row execute function private.app_cpe_direct_conversation_chapas();

create function private.app_cpe_direct_message_chapa()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.sender_chapa := (select u.chapa from public.app_cpe_users u where u.id = new.sender_id);
  return new;
end;
$$;
create trigger app_cpe_direct_message_chapa_trigger
before insert or update on public.app_cpe_direct_messages
for each row execute function private.app_cpe_direct_message_chapa();

create function private.app_cpe_direct_read_chapa()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.user_chapa := (select u.chapa from public.app_cpe_users u where u.id = new.user_id);
  return new;
end;
$$;
create trigger app_cpe_direct_read_chapa_trigger
before insert or update on public.app_cpe_direct_reads
for each row execute function private.app_cpe_direct_read_chapa();

update public.app_cpe_direct_conversations set user_low_chapa = user_low_chapa;
update public.app_cpe_direct_messages set sender_chapa = sender_chapa;
update public.app_cpe_direct_reads set user_chapa = user_chapa;

alter table public.app_cpe_direct_conversations
  alter column user_low_chapa set not null,
  alter column user_high_chapa set not null;
alter table public.app_cpe_direct_messages
  alter column sender_chapa set not null;
alter table public.app_cpe_direct_reads
  alter column user_chapa set not null;

-- Keep the descriptive columns current if a worker's badge number changes.
create function private.app_cpe_direct_refresh_chapas()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.app_cpe_direct_conversations
    set user_low_chapa = case when user_low_id = new.id then new.chapa else user_low_chapa end,
        user_high_chapa = case when user_high_id = new.id then new.chapa else user_high_chapa end
    where user_low_id = new.id or user_high_id = new.id;
  update public.app_cpe_direct_messages set sender_chapa = new.chapa where sender_id = new.id;
  update public.app_cpe_direct_reads set user_chapa = new.chapa where user_id = new.id;
  return new;
end;
$$;
create trigger app_cpe_direct_refresh_chapas_trigger
after update of chapa on public.app_cpe_users
for each row when (old.chapa is distinct from new.chapa)
execute function private.app_cpe_direct_refresh_chapas();

revoke all on function private.app_cpe_direct_conversation_chapas(),
  private.app_cpe_direct_message_chapa(), private.app_cpe_direct_read_chapa(),
  private.app_cpe_direct_refresh_chapas() from public, anon, authenticated;

comment on table public.app_cpe_direct_conversations is
  'Una conversación privada por pareja de usuarios. user_low_id y user_high_id son los participantes; las chapas son etiquetas legibles.';
comment on table public.app_cpe_direct_messages is
  'Mensajes de cada conversación privada. sender_id identifica al autor y sender_chapa muestra su chapa.';
comment on table public.app_cpe_direct_reads is
  'Estado de lectura por usuario y conversación: last_read_at marca hasta cuándo leyó y hidden_at cuándo ocultó el chat de su lista.';
comment on column public.app_cpe_direct_conversations.user_low_chapa is 'Chapa del participante user_low_id.';
comment on column public.app_cpe_direct_conversations.user_high_chapa is 'Chapa del participante user_high_id.';
comment on column public.app_cpe_direct_messages.sender_chapa is 'Chapa del autor sender_id.';
comment on column public.app_cpe_direct_reads.user_chapa is 'Chapa del usuario user_id al que pertenece este estado de lectura.';
