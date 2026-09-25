-- Private chats use the same in-app notification feed as exchange messages.
alter table public.app_cpe_user_notifications
  drop constraint app_cpe_user_notifications_event_type_check;
alter table public.app_cpe_user_notifications
  add constraint app_cpe_user_notifications_event_type_check check (event_type in (
    'new_journal', 'new_premium', 'premium_modified', 'new_payroll',
    'rests_changed', 'vacations_changed', 'exceptions_changed',
    'rest_proposal', 'rest_response', 'rest_message',
    'vacation_proposal', 'vacation_response', 'vacation_message',
    'direct_message'
  ));
alter table public.app_cpe_user_notifications
  drop constraint app_cpe_user_notifications_target_tab_check;
alter table public.app_cpe_user_notifications
  add constraint app_cpe_user_notifications_target_tab_check check (target_tab in (
    'contratacion', 'sueldometro', 'nominas', 'descansos', 'vacaciones',
    'excepciones', 'conversaciones'
  ));

create function private.app_cpe_notify_direct_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_cpe_user_notifications
    (user_id, chapa, event_type, title, body, entity_key, change_hash,
     target_tab, metadata, created_at)
  select recipient.id, recipient.chapa, 'direct_message',
    'Mensaje privado de ' || split_part(coalesce(nullif(btrim(sender.display_name), ''),
      'Usuario'), ' ', 1) || ' · ' || sender.chapa,
    'Abre el chat para leerlo.', new.conversation_id::text, new.id::text,
    'conversaciones', jsonb_build_object('conversationId', new.conversation_id),
    new.created_at
  from public.app_cpe_direct_conversations c
  join public.app_cpe_users sender on sender.id = new.sender_id
  join public.app_cpe_users recipient on recipient.id = case
    when c.user_low_id = new.sender_id then c.user_high_id else c.user_low_id end
  where c.id = new.conversation_id
    and new.sender_id in (c.user_low_id, c.user_high_id)
  on conflict (chapa, event_type, entity_key, change_hash) do nothing;
  return new;
end;
$$;
revoke all on function private.app_cpe_notify_direct_message() from public, anon, authenticated;
create trigger app_cpe_direct_message_notification
  after insert on public.app_cpe_direct_messages
  for each row execute function private.app_cpe_notify_direct_message();

-- Restore notifications for messages sent before this trigger existed.
insert into public.app_cpe_user_notifications
  (user_id, chapa, event_type, title, body, entity_key, change_hash,
   target_tab, metadata, created_at)
select recipient.id, recipient.chapa, 'direct_message',
  'Mensaje privado de ' || split_part(coalesce(nullif(btrim(sender.display_name), ''),
    'Usuario'), ' ', 1) || ' · ' || sender.chapa,
  'Abre el chat para leerlo.', m.conversation_id::text, m.id::text,
  'conversaciones', jsonb_build_object('conversationId', m.conversation_id),
  m.created_at
from public.app_cpe_direct_messages m
join public.app_cpe_direct_conversations c on c.id = m.conversation_id
join public.app_cpe_users sender on sender.id = m.sender_id
join public.app_cpe_users recipient on recipient.id = case
  when c.user_low_id = m.sender_id then c.user_high_id else c.user_low_id end
where m.sender_id in (c.user_low_id, c.user_high_id)
on conflict (chapa, event_type, entity_key, change_hash) do nothing;

create or replace function public.app_cpe_direct_mark_read(p_token text, p_conversation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  v_user_id := private.app_cpe_direct_actor(p_token);
  if not exists(select 1 from public.app_cpe_direct_conversations c where c.id = p_conversation_id
    and (c.user_low_id = v_user_id or c.user_high_id = v_user_id)) then
    raise exception 'Conversacion no disponible';
  end if;
  insert into public.app_cpe_direct_reads (conversation_id, user_id, last_read_at)
  values (p_conversation_id, v_user_id, now())
  on conflict (conversation_id, user_id) do update
    set last_read_at = greatest(public.app_cpe_direct_reads.last_read_at, excluded.last_read_at);
  update public.app_cpe_user_notifications
    set read_at = now()
    where user_id = v_user_id and event_type = 'direct_message'
      and entity_key = p_conversation_id::text and read_at is null;
  return true;
end;
$$;
