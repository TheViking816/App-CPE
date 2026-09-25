-- A chat can be removed from one user's view without deleting the other
-- participant's messages. A new message makes it visible again.
alter table public.app_cpe_direct_reads
  add column if not exists hidden_at timestamptz;

create or replace function public.app_cpe_direct_threads(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  v_user_id := private.app_cpe_direct_actor(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'counterpartChapa', other.chapa,
      'counterpartName', coalesce(nullif(btrim(other.display_name), ''), 'Usuario ' || other.chapa),
      'online', exists(select 1 from public.app_cpe_sessions s
        where s.user_id = other.id and s.expires_at > now()
          and not coalesce(s.is_support, false)
          and s.last_seen_at >= now() - interval '15 minutes'),
      'lastMessage', m.body, 'lastAt', m.created_at,
      'unread', (select count(*) from public.app_cpe_direct_messages unread
        where unread.conversation_id = c.id and unread.sender_id <> v_user_id
          and unread.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz))
    ) order by m.created_at desc), '[]'::jsonb)
    from public.app_cpe_direct_conversations c
    join public.app_cpe_users other
      on other.id = case when c.user_low_id = v_user_id then c.user_high_id else c.user_low_id end
    left join public.app_cpe_direct_reads r on r.conversation_id = c.id and r.user_id = v_user_id
    left join lateral (select id, body, created_at from public.app_cpe_direct_messages
      where conversation_id = c.id order by created_at desc limit 1) m on true
    where (c.user_low_id = v_user_id or c.user_high_id = v_user_id)
      and m.id is not null
      and (r.hidden_at is null or m.created_at > r.hidden_at));
end;
$$;

create or replace function public.app_cpe_direct_messages(p_token text, p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid; v_hidden_at timestamptz;
begin
  v_user_id := private.app_cpe_direct_actor(p_token);
  if not exists(select 1 from public.app_cpe_direct_conversations c where c.id = p_conversation_id
    and (c.user_low_id = v_user_id or c.user_high_id = v_user_id)) then
    raise exception 'Conversacion no disponible';
  end if;
  select hidden_at into v_hidden_at from public.app_cpe_direct_reads
  where conversation_id = p_conversation_id and user_id = v_user_id;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', messages.id, 'body', messages.body,
      'createdAt', messages.created_at, 'isOwn', messages.sender_id = v_user_id
    ) order by messages.created_at), '[]'::jsonb)
    from (select id, body, created_at, sender_id from public.app_cpe_direct_messages
      where conversation_id = p_conversation_id
        and created_at > coalesce(v_hidden_at, '-infinity'::timestamptz)
      order by created_at desc limit 100) messages);
end;
$$;

create function public.app_cpe_direct_delete(p_token text, p_conversation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  v_user_id := private.app_cpe_direct_actor(p_token);
  if not exists(select 1 from public.app_cpe_direct_conversations c where c.id = p_conversation_id
    and (c.user_low_id = v_user_id or c.user_high_id = v_user_id)) then
    raise exception 'Conversacion no disponible';
  end if;
  insert into public.app_cpe_direct_reads (conversation_id, user_id, last_read_at, hidden_at)
  values (p_conversation_id, v_user_id, now(), now())
  on conflict (conversation_id, user_id) do update
    set last_read_at = now(), hidden_at = now();
  return true;
end;
$$;

revoke all on function public.app_cpe_direct_delete(text,uuid) from public, anon, authenticated;
grant execute on function public.app_cpe_direct_delete(text,uuid) to anon, authenticated;
